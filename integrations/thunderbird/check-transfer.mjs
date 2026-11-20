import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const [executable, addon] = process.argv.slice(2);
if (!executable) throw new Error("Pass the Thunderbird executable path.");
const root = new URL("../..", import.meta.url);
const script = await readFile(new URL("./provision.js", import.meta.url), "utf8");
const browserBuild = await build({
  entryPoints: [fileURLToPath(new URL("../../packages/sdk/dist/browser.js", import.meta.url))],
  bundle: true, platform: "browser", format: "iife", globalName: "MailPortBrowser", write: false,
});
const browserBundle = browserBuild.outputFiles[0].text;
const artifacts = execFileSync("cargo", [
  "build", "--locked", "-p", "mailport-core", "--example", "compatibility", "--message-format=json",
], { cwd: root, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "inherit"] });
const sender = artifacts.trim().split("\n").map(line => JSON.parse(line)).find(artifact =>
  artifact.reason === "compiler-artifact" && artifact.target?.name === "compatibility" && artifact.executable,
)?.executable;
assert.ok(sender, "Cargo did not report the MailPort compatibility executable");

function syntheticAccount(number) {
  return {
    id: `00000000-0000-4000-8000-00000000000${number}`,
    email: `synthetic-${number}@example.com`,
    displayName: `MailPort Test ${number} — Thunderbird`,
    incoming: {
      host: "imap.example.test", port: 993, security: "tls", username: `imap-${number}`,
      auth: { type: "password", password: `PUBLIC-SYNTHETIC-IMAP-${number}` },
    },
    outgoing: {
      host: "smtp.example.test", port: 587, security: "starttls", username: `smtp-${number}`,
      auth: { type: "password", password: `PUBLIC-SYNTHETIC-SMTP-${number}` },
    },
  };
}
const accounts = [1, 2].map(syntheticAccount);
const profile = await mkdtemp(join(tmpdir(), "mailport-thunderbird-"));
const portFile = join(profile, "MarionetteActivePort");
let instance;

async function waitFor(read, description) {
  const deadline = performance.now() + 15000;
  do {
    const value = await read();
    if (value) return value;
    await delay(100);
  } while (performance.now() < deadline);
  throw new Error(`Timed out waiting for ${description}`);
}

function readIfPresent(file) {
  return readFile(file, "utf8").catch(error => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
}

async function start() {
  assert.equal(instance, undefined);
  await rm(portFile, { force: true });
  const child = spawn(executable, [
    "-no-remote", "-profile", profile, "-headless", "-offline",
    "--marionette", "--remote-allow-system-access",
  ], { stdio: "ignore" });
  const exited = once(child, "exit");
  exited.catch(() => {});
  instance = { child, exited };
  const port = Number(await Promise.race([
    waitFor(() => readIfPresent(portFile), "Thunderbird's Marionette port"),
    exited.then(() => { throw new Error("Thunderbird exited during startup"); }),
  ]));
  assert.ok(Number.isInteger(port) && port > 0 && port < 65536);
  const socket = connect(port, "127.0.0.1");
  instance.socket = socket;
  socket.setTimeout(35000, () => socket.destroy(new Error("Thunderbird command timed out")));
  const messages = socket[Symbol.asyncIterator]();
  let buffer = Buffer.alloc(0);
  let id = 0;

  async function packet() {
    for (;;) {
      const separator = buffer.indexOf(58);
      if (separator !== -1) {
        const size = Number(buffer.subarray(0, separator).toString());
        assert.ok(Number.isSafeInteger(size) && size > 0 && size < 1024 * 1024);
        const end = separator + 1 + size;
        if (buffer.length >= end) {
          const value = JSON.parse(buffer.subarray(separator + 1, end));
          buffer = buffer.subarray(end);
          return value;
        }
      }
      const next = await messages.next();
      if (next.done) throw new Error("Thunderbird closed the automation connection");
      buffer = Buffer.concat([buffer, next.value]);
    }
  }

  async function command(name, parameters) {
    const message = Buffer.from(JSON.stringify([0, ++id, name, parameters]));
    socket.write(Buffer.concat([Buffer.from(`${message.length}:`), message]));
    const [type, responseId, error, result] = await packet();
    assert.equal(type, 1);
    assert.equal(responseId, id);
    if (error) throw new Error(`Thunderbird command failed: ${name} (${error.error})`);
    return result;
  }

  assert.equal((await packet()).marionetteProtocol, 3);
  const { capabilities } = await command("WebDriver:NewSession", {
    capabilities: { alwaysMatch: {}, firstMatch: [{}] },
  });
  assert.equal(capabilities.browserName, "thunderbird");
  assert.equal(capabilities["moz:processID"], child.pid);
  assert.equal(capabilities["moz:profile"], profile);
  assert.equal(capabilities["moz:headless"], true);
  await command("Marionette:SetContext", { value: "chrome" });
  instance.command = command;
  return capabilities.browserVersion;
}

async function stop(crash = false) {
  if (!instance) return;
  const { child, socket, exited, command } = instance;
  instance = undefined;
  try {
    if (child.exitCode === null && child.signalCode === null) {
      if (crash || !command) child.kill("SIGKILL");
      else await command("Marionette:Quit", { flags: ["eForceQuit"] });
    }
    const timeout = new AbortController();
    try {
      const result = await Promise.race([
        exited,
        delay(10000, null, { signal: timeout.signal }).then(() => {
          throw new Error("Thunderbird did not exit");
        }),
      ]);
      if (crash) assert.equal(result[1], "SIGKILL");
    } finally {
      timeout.abort();
    }
  } catch (error) {
    child.kill("SIGKILL");
    await exited.catch(() => {});
    throw error;
  } finally {
    socket?.destroy();
  }
}

async function provision(account, inspectOnly = false) {
  const result = await instance.command("WebDriver:ExecuteAsyncScript", {
    script: `${script}
      const done = arguments[arguments.length - 1];
      provision(arguments[0], arguments[1]).then(done, error => {
        done({ failed: true, reason: error.message.startsWith("Conflicting Thunderbird") ? "conflict" : "backend" });
      });`,
    args: [account, inspectOnly],
  });
  if (result.value?.failed) throw new Error(`Thunderbird provisioning failed: ${result.value.reason}`);
  return result.value;
}

async function browserCommand(owner, body, args = []) {
  const { value } = await owner.command("WebDriver:ExecuteAsyncScript", {
    sandbox: "system",
    newSandbox: false,
    script: `const done = arguments[arguments.length - 1];
      (async () => { ${body} })().then(value => done({ value }), error => done({
        error: typeof error.code === "string" ? error.code : "BROWSER_RECEIVER",
      }));`,
    args,
  });
  if (value.error) throw new Error(`Thunderbird receiver failed: ${value.error}`);
  return value.value;
}

let attempt = 0;
async function transfer(selected, { stopAfterFirst = false, expectProcessExit = false } = {}) {
  const owner = instance;
  if (!owner.browserLoaded) {
    await browserCommand(owner, `
      if (typeof Buffer !== "undefined" || typeof require !== "undefined") {
        throw new Error("Expected a browser runtime");
      }
      ${browserBundle}
      globalThis.mailPortBrowser = MailPortBrowser;
      return null;
    `);
    owner.browserLoaded = true;
  }
  const request = await browserCommand(owner, `
    const session = await globalThis.mailPortBrowser.ImportRequestSession.create("Thunderbird synthetic preview");
    globalThis.mailPortSession = session;
    return { requestFile: session.requestFile, verificationCode: session.verificationCode };
  `);
  const requestPath = join(profile, `test-${++attempt}.mailport-request`);
  const packagePath = join(profile, `test-${attempt}.mailport`);
  try {
    await writeFile(requestPath, request.requestFile, { mode: 0o600 });
    const sealed = JSON.parse(execFileSync(sender, ["seal-transfer"], {
      input: JSON.stringify({
        requestFile: await readFile(requestPath, "utf8"), accounts: selected, ids: selected.map(account => account.id),
      }),
      encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "ignore"],
    }));
    assert.equal(sealed.verificationCode, request.verificationCode);
    await writeFile(packagePath, sealed.package, { mode: 0o600 });
    const serialized = await readFile(packagePath, "utf8");
    return await browserCommand(owner, `
      ${script}
      const [serialized, verifiedCode, stopAfterFirst] = arguments;
      const session = globalThis.mailPortSession;
      if (await globalThis.mailPortBrowser.transferPackageCode(serialized) !== verifiedCode) {
        throw new Error("Transfer code mismatch");
      }
      const wrongCode = (verifiedCode[0] === "0" ? "1" : "0") + verifiedCode.slice(1);
      let called = false;
      try {
        await session.importPackage({
          serialized, verifiedCode: wrongCode,
          adapter: { async upsertAccount() { called = true; } },
        });
        throw new Error("Unverified transfer was accepted");
      } catch (error) {
        if (called || error.code !== "CODE_MISMATCH") throw error;
      }
      const controller = new AbortController();
      const observed = [];
      const result = await session.importPackage({
        serialized, verifiedCode, signal: controller.signal,
        adapter: {
          async upsertAccount(account) {
            observed.push(await provision(account, false));
            if (stopAfterFirst) controller.abort();
          },
        },
      });
      return { statuses: result.results.map(item => item.status), observed };
    `, [serialized, sealed.packageCode, stopAfterFirst]);
  } catch (error) {
    if (!expectProcessExit || instance === owner) throw error;
    const [, signal] = await owner.exited;
    if (signal !== "SIGKILL") throw error;
    return { statuses: selected.map(() => "failed"), observed: [] };
  } finally {
    if (instance === owner) {
      await browserCommand(owner, `
        globalThis.mailPortSession?.close();
        delete globalThis.mailPortSession;
        return null;
      `);
    }
  }
}

async function assertEncrypted(loginCount) {
  const stored = await waitFor(async () => {
    const text = await readIfPresent(join(profile, "logins.json"));
    if (text && JSON.parse(text).logins.length === loginCount) return text;
  }, "the Thunderbird login store");
  const prefs = await readFile(join(profile, "prefs.js"), "utf8");
  assert.ok(!stored.includes("PUBLIC-SYNTHETIC"));
  assert.ok(!prefs.includes("PUBLIC-SYNTHETIC"));
  const logins = JSON.parse(stored).logins;
  assert.ok(logins.every(login => login.encryptedUsername && login.encryptedPassword));
  return logins;
}

async function interruptAccountSetup(account, boundary) {
  const barrier = join(profile, "account-write-barrier.json");
  await rm(barrier, { force: true });
  await instance.command("WebDriver:ExecuteScript", {
    script: `const [barrier, boundary] = arguments;
      const { CreateInBackend } = ChromeUtils.importESModule(
        "resource:///modules/accountcreation/CreateInBackend.sys.mjs",
      );
      const create = CreateInBackend.createAccountInBackend;
      CreateInBackend.createAccountInBackend = async config => {
        if (boundary === "after-save") await create(config);
        if (boundary === "before-link") {
          const interruption = new Error("Synthetic stop before Thunderbird links the account");
          // Native setup reads this preference after creating the incoming server
          // and identity, immediately before linking the account.
          Object.defineProperty(config.incoming, "useGlobalPreferredServer", {
            get() {
              Services.prefs.savePrefFile(null);
              throw interruption;
            },
          });
          try {
            await create(config);
          } catch (error) {
            if (error !== interruption) throw error;
          }
        }
        await IOUtils.writeJSON(barrier, { smtpKey: config.outgoing.existingServerKey });
        await new Promise(() => {});
      };`,
    args: [barrier, boundary],
  });
  const pending = transfer([account], { expectProcessExit: true });
  const { smtpKey } = JSON.parse(await waitFor(() => readIfPresent(barrier), "native account-write boundary"));
  assert.ok(smtpKey);
  const prefs = await readFile(join(profile, "prefs.js"), "utf8");
  assert.ok(prefs.includes(`user_pref("mail.smtpserver.${smtpKey}.username", "${account.outgoing.username}")`));
  assert.equal(prefs.includes(`"${account.email}"`), boundary !== "before-setup");
  assert.equal(prefs.includes(`user_pref("mail.server.`) && prefs.includes(`"${account.incoming.username}"`),
    boundary !== "before-setup");
  const { guids } = JSON.parse(await readFile(join(profile, "mailport-pending.json"), "utf8"));
  const staleServer = prefs.split("\n").find(line =>
    line.startsWith('user_pref("mail.server.') && line.includes(`.mailportImport", "${guids[0]}"`));
  if (boundary === "before-link") assert.ok(staleServer);
  await stop(true);
  assert.deepEqual(await pending, { statuses: ["failed"], observed: [] });
  await start();
  return { smtpKey, staleKey: staleServer?.split(".")[2] };
}

async function smtpKeys(account) {
  const { value } = await instance.command("WebDriver:ExecuteScript", {
    script: `const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
      return MailServices.outgoingServer.servers
        .filter(server => server.type === "smtp" && server.username === arguments[0])
        .map(server => server.key);`,
    args: [account.outgoing.username],
  });
  return value;
}

async function checkAddon(version) {
  const id = "mailport-preview@mailport.invalid";
  const { value: installed } = await instance.command("Addon:Install", {
    path: resolve(addon), temporary: true,
  });
  assert.equal(installed, id);
  await browserCommand(instance, `
    const tabmail = document.getElementById("tabmail");
    const setup = tabmail.tabInfo.find(tab => tab.browser?.currentURI?.spec === "about:accountsetup");
    if (setup) tabmail.closeTab(setup);
    tabmail.switchToTab(0);
    return null;
  `);

  async function loadPage(enable) {
    const url = await browserCommand(instance, `
      Services.prefs.setBoolPref("mailport.preview.enabled", arguments[1]);
      const policy = WebExtensionPolicy.getByID(arguments[0]);
      const tabmail = document.getElementById("tabmail");
      if (globalThis.mailPortAddonTab) tabmail.closeTab(globalThis.mailPortAddonTab);
      return policy.getURL("import.html");
    `, [id, enable]);
    await waitFor(() => browserCommand(instance, `
      const action = document.querySelector("#unifiedToolbarContent [extension='" + arguments[0] + "']");
      if (!action || action.disabled) return false;
      Services.focus.focusedWindow = window;
      action.focus();
      action.click();
      return true;
    `, [id]), "the MailPort toolbar action");
    await waitFor(() => browserCommand(instance, `
      const tab = document.getElementById("tabmail").tabInfo.find(item =>
        item.browser?.currentURI?.spec === arguments[0]);
      if (!tab || tab.browser.webProgress.isLoadingDocument) return false;
      globalThis.mailPortAddonTab = tab;
      return true;
    `, [url]), "the MailPort extension tab");
  }

  // Gecko's Marionette tab enumeration is Firefox-specific. Target the
  // Thunderbird tab's own WebDriver actor to exercise the actual extension page.
  function runPage(script, args = []) {
    return browserCommand(instance, `
      const [script, args] = arguments;
      const window = globalThis.mailPortAddonTab.browser.browsingContext.currentWindowGlobal;
      return window.getActor("MarionetteCommands").executeScript(script, args, {
        sandboxName: null, newSandbox: false, async: false, timeout: 5000,
      });
    `, [script, args]);
  }

  async function statusIncludes(text) {
    await waitFor(() => runPage(
      "return document.querySelector('#status')?.textContent.includes(arguments[0]) === true;",
      [text],
    ), "the expected importer status");
  }

  await loadPage(false);
  await statusIncludes("Use an offline profile");
  assert.equal(await runPage("return document.querySelector('#create-request').disabled;"), true);

  await loadPage(true);
  await waitFor(() => runPage("return document.querySelector('#create-request')?.disabled === false;"),
    "the request button");
  await runPage("document.querySelector('#create-request').click();");
  await statusIncludes("Request ready");
  const requestCode = await runPage(`document.querySelector("#save-request").click();
    return document.querySelector("#request-code").textContent;`);
  const requestFile = await waitFor(async () => {
    const saved = await readIfPresent(join(profile, "Thunderbird.mailport-request"));
    if (saved.endsWith("}")) return saved;
  }, "the downloaded request file");
  const sealed = JSON.parse(execFileSync(sender, ["seal-transfer"], {
    input: JSON.stringify({ requestFile, accounts, ids: accounts.map(account => account.id) }),
    encoding: "utf8", timeout: 30000, stdio: ["pipe", "pipe", "ignore"],
  }));
  assert.equal(requestCode, sealed.verificationCode);

  const transferPath = join(profile, "test.mailport");
  await writeFile(transferPath, sealed.package, { mode: 0o600 });
  await runPage(`const file = new File([arguments[0]], "test.mailport");
    const input = document.querySelector("#transfer-file");
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));`, [await readFile(transferPath, "utf8")]);
  await statusIncludes("Compare the transfer code");
  assert.equal(await runPage("return document.querySelector('#transfer-code').textContent;"), sealed.packageCode);

  async function enterCode(code) {
    await runPage(`document.querySelector("#verified-code").value = arguments[0];
      document.querySelector("#import-accounts").click();`, [code]);
  }

  const wrong = (sealed.packageCode[0] === "0" ? "1" : "0") + sealed.packageCode.slice(1);
  await enterCode(wrong);
  await statusIncludes("The codes do not match");
  assert.ok(!(await readIfPresent(join(profile, "logins.json"))).includes("imap.example.test"));

  await enterCode(sealed.packageCode);
  await statusIncludes("Saved 2 of 2 accounts in Thunderbird");
  await assertEncrypted(4);
  await instance.command("Marionette:SetContext", { value: "chrome" });
  await stop();
  await start();
  for (const account of accounts) assert.equal(await provision(account, true), "match");
  await assertEncrypted(4);
  console.log(`Thunderbird ${version}: installed the XPI, checked the confirmation, saved two accounts, and verified both after restart.`);
}

async function checkRecovery(version) {
  assert.deepEqual(await transfer(accounts, { stopAfterFirst: true }), {
    statuses: ["configured", "cancelled"], observed: ["created"],
  });
  await assertEncrypted(2);
  await stop(true);
  await start();
  assert.equal(await provision(accounts[0], true), "match");
  assert.equal(await provision(accounts[1], true), "absent");
  assert.deepEqual(await transfer(accounts), {
    statuses: ["configured", "configured"], observed: ["match", "created"],
  });
  const originalLogins = await assertEncrypted(4);

  const conflict = structuredClone(accounts[0]);
  conflict.outgoing.auth.password = "PUBLIC-SYNTHETIC-CONFLICT";
  assert.equal(await provision(conflict, true), "conflict");
  assert.deepEqual(await transfer([conflict]), { statuses: ["failed"], observed: [] });
  await stop();
  await start();
  for (const account of accounts) assert.equal(await provision(account, true), "match");
  await assertEncrypted(4);

  const interrupted = syntheticAccount(3);
  await instance.command("WebDriver:ExecuteScript", {
    script: `const { LoginManager } = ChromeUtils.importESModule("resource://gre/modules/LoginManager.sys.mjs");
      const add = LoginManager.prototype.addLoginAsync;
      LoginManager.prototype.addLoginAsync = function (login) {
        if (login.username === "smtp-3") return new Promise(() => {});
        return add.call(this, login);
      };`,
    args: [],
  });
  const partial = transfer([interrupted], { expectProcessExit: true });
  // Thunderbird has saved the incoming login while the outgoing save is blocked.
  const partialLogins = await assertEncrypted(5);
  const journalPath = join(profile, "mailport-pending.json");
  const marker = await readFile(journalPath, "utf8");
  assert.ok(!marker.includes("PUBLIC-SYNTHETIC"));
  const { guids } = JSON.parse(marker);
  const orphan = partialLogins.find(login => login.guid === guids[0]);
  assert.ok(orphan);
  assert.ok(!partialLogins.some(login => login.guid === guids[1]));
  await stop(true);
  assert.deepEqual(await partial, { statuses: ["failed"], observed: [] });
  await start();
  assert.equal(await provision(interrupted, true), "pending");
  const wrongPassword = structuredClone(interrupted);
  wrongPassword.incoming.auth.password = "PUBLIC-SYNTHETIC-CONFLICT";
  assert.deepEqual(await transfer([wrongPassword]), { statuses: ["failed"], observed: [] });
  const unrelated = { ...interrupted, id: syntheticAccount(4).id };
  assert.deepEqual(await transfer([unrelated]), { statuses: ["failed"], observed: [] });
  assert.deepEqual(await assertEncrypted(5), partialLogins);
  assert.equal(await readFile(journalPath, "utf8"), marker);

  assert.deepEqual(await transfer([interrupted]), { statuses: ["configured"], observed: ["recovered"] });
  assert.equal(await readIfPresent(journalPath), "");
  await stop(true);
  await start();
  assert.equal(await provision(interrupted, true), "match");
  for (const account of accounts) assert.equal(await provision(account, true), "match");
  const finalLogins = await assertEncrypted(6);
  for (const login of [...originalLogins, orphan]) {
    assert.deepEqual(finalLogins.find(item => item.guid === login.guid), login);
  }
  assert.ok(finalLogins.some(login => login.guid === guids[1]));
  assert.deepEqual(await transfer([interrupted]), { statuses: ["configured"], observed: ["match"] });

  for (const [index, boundary] of ["before-setup", "before-link", "after-save"].entries()) {
    const account = syntheticAccount(index + 4);
    const afterSave = boundary === "after-save";
    const unrelatedKey = "server9001";
    if (boundary === "before-link") {
      await instance.command("WebDriver:ExecuteScript", {
        script: `const [key, username] = arguments;
          Services.prefs.setStringPref(\`mail.server.\${key}.type\`, "imap");
          Services.prefs.setStringPref(\`mail.server.\${key}.hostname\`, "imap.example.test");
          Services.prefs.setStringPref(\`mail.server.\${key}.userName\`, username);
          Services.prefs.savePrefFile(null);`,
        args: [unrelatedKey, account.incoming.username],
      });
    }
    const { smtpKey, staleKey } = await interruptAccountSetup(account, boundary);
    assert.equal(await provision(account, true), afterSave ? "match" : "pending");
    assert.deepEqual(await smtpKeys(account), [smtpKey]);
    if (boundary === "before-setup") {
      const ownerPref = `mail.smtpserver.${smtpKey}.mailportImport`;
      const { guids } = JSON.parse(await readFile(journalPath, "utf8"));
      const setOwner = owner => instance.command("WebDriver:ExecuteScript", {
        script: "Services.prefs.setStringPref(arguments[0], arguments[1]);",
        args: [ownerPref, owner],
      });
      await setOwner("different-import");
      assert.equal(await provision(account, true), "conflict");
      assert.deepEqual(await transfer([account]), { statuses: ["failed"], observed: [] });
      assert.deepEqual(await smtpKeys(account), [smtpKey]);
      await setOwner(guids[1]);
    }
    assert.deepEqual(await transfer([account]), {
      statuses: ["configured"], observed: [afterSave ? "match" : "recovered"],
    });
    assert.equal(await readIfPresent(journalPath), "");
    await stop(true);
    await start();
    assert.equal(await provision(account, true), "match");
    assert.deepEqual(await smtpKeys(account), [smtpKey]);
    const prefs = await readFile(join(profile, "prefs.js"), "utf8");
    assert.ok(!prefs.includes(`mail.smtpserver.${smtpKey}.mailportImport`));
    if (boundary === "before-link") {
      assert.ok(!prefs.includes(`mail.server.${staleKey}.`));
      assert.ok(prefs.includes(`user_pref("mail.server.${unrelatedKey}.userName", "${account.incoming.username}")`));
    }
  }
  const recoveredLogins = await assertEncrypted(12);
  for (const login of finalLogins) {
    assert.deepEqual(recoveredLogins.find(item => item.guid === login.guid), login);
  }
  for (const account of [...accounts, interrupted]) assert.equal(await provision(account, true), "match");

  console.log(`Thunderbird ${version}: recovered interrupted credential and account writes without duplicating accounts or SMTP servers.`);
}

try {
  await writeFile(join(profile, "user.js"), [
    'user_pref("marionette.port", 0);',
    'user_pref("mail.shell.checkDefaultClient", false);',
    'user_pref("mail.provider.enabled", false);',
    'user_pref("mailnews.start_page.enabled", false);',
    'user_pref("browser.download.folderList", 2);',
    'user_pref("browser.download.useDownloadDir", true);',
    `user_pref("browser.download.dir", ${JSON.stringify(profile)});`,
  ].join("\n"));
  const version = await start();
  if (addon) await checkAddon(version);
  else await checkRecovery(version);
} finally {
  try {
    await stop();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
