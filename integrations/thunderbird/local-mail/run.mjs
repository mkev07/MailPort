import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connect } from "node:tls";
import { fileURLToPath } from "node:url";

const executable = process.argv[2];
if (!executable) throw new Error("Pass a Thunderbird ESR executable.");
const dir = fileURLToPath(new URL("./", import.meta.url));
const root = fileURLToPath(new URL("../../..", import.meta.url));
const xpi = resolve(root, "dist/thunderbird/mailport-preview.xpi");
const image = "mailport-local-mail:fixture";
const settings = { stdio: "inherit" };
const staging = await mkdtemp(join(tmpdir(), "mailport-servers-"));
const tls = join(staging, "tls");
const caFile = join(staging, "ca.pem");
const clientId = join(staging, "mailspring.cid");
let container;

function docker(args) {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 30000 }).trim();
}

function waitForImap(port, ca) {
  return new Promise((resolve, reject) => {
    const connection = connect({
      host: "127.0.0.1", port, servername: "imap.example.test", ca, rejectUnauthorized: true,
    });
    connection.setTimeout(1000, () => connection.destroy(new Error("IMAP startup timed out")));
    connection.once("error", reject);
    connection.once("secureConnect", () => {
      connection.end();
      resolve();
    });
  });
}

try {
  execFileSync("node", ["integrations/thunderbird/build-extension.mjs"], { ...settings, cwd: root });
  execFileSync("docker", ["build", "-t", image, dir], { ...settings, timeout: 180000 });

  await mkdir(tls);
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-subj", "/CN=MailPort disposable test CA", "-days", "1",
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign",
    "-keyout", join(staging, "ca.key"), "-out", caFile,
  ]);
  execFileSync("openssl", [
    "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes",
    "-subj", "/CN=imap.example.test", "-keyout", join(tls, "server.key"),
    "-out", join(staging, "server.csr"),
  ]);
  const extensions = join(staging, "server.ext");
  await writeFile(extensions, "basicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\n" +
    "subjectAltName=DNS:imap.example.test,DNS:smtp.example.test,DNS:localhost\n");
  execFileSync("openssl", [
    "x509", "-req", "-in", join(staging, "server.csr"), "-CA", caFile, "-CAkey", join(staging, "ca.key"),
    "-CAcreateserial", "-days", "1", "-extfile", extensions, "-out", join(tls, "server.pem"),
  ]);

  container = docker([
    "run", "--detach", "--rm", "--publish", "127.0.0.1::1993", "--publish", "127.0.0.1::1587",
    "--mount", `type=bind,src=${tls},dst=/tls,readonly`, image,
  ]);
  const discover = port => {
    const output = docker(["port", container, `${port}/tcp`]);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(output);
    assert.ok(match, "The test mail port must be bound to loopback only");
    return Number(match[1]);
  };
  const imapPort = discover(1993);
  const smtpPort = discover(1587);
  const ca = await readFile(caFile, "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await waitForImap(imapPort, ca);
      break;
    } catch (error) {
      if (attempt === 19) throw error;
      await delay(250);
    }
  }
  execFileSync("node", [
    "integrations/thunderbird/check-transfer.mjs", resolve(executable), xpi,
  ], {
    ...settings, cwd: root, timeout: 120000,
    env: { ...process.env, MAILPORT_LOCAL_MAIL: JSON.stringify({ ca, imapPort, smtpPort }) },
  });
  const mailspringImage = process.argv[3];
  if (mailspringImage) {
    const countMessages = () => [1, 2].map(index => {
      const files = docker(["exec", container, "find", `/mail/imap-${index}/Maildir`,
        "-type", "f", "(", "-path", "*/new/*", "-o", "-path", "*/cur/*", ")"]);
      return files ? files.split("\n").length : 0;
    });
    const initial = countMessages();
    execFileSync("docker", [
      "run", "--rm", "--cidfile", clientId, "--network", `container:${container}`, "--shm-size=1g", "--user", "0",
      "--mount", `type=bind,src=${caFile},dst=/usr/local/share/ca-certificates/mailport-fixture.crt,readonly`,
      "--mount", `type=bind,src=${join(root, "integrations/mailspring/check-import-ui.cjs")},dst=/work/mailport/integrations/mailspring/check-import-ui.cjs,readonly`,
      "-e", `MAILPORT_LOCAL_MAIL=${JSON.stringify({ imapPort: 1993, smtpPort: 1587 })}`,
      mailspringImage, "sh", "-ec",
      "update-ca-certificates && runuser -u node -- env HOME=/home/node xvfb-run -a dbus-run-session -- " +
        "sh -ec 'echo mailport-fixture | gnome-keyring-daemon --unlock --components=secrets >/dev/null; " +
        "node integrations/mailspring/check-import-ui.cjs /home/node/mailspring'",
    ], { ...settings, timeout: 120000 });
    assert.ok(countMessages().every((count, index) => count > initial[index]),
      "Mailspring's SMTP check should deliver a test message to both local inboxes");
    console.log("The local SMTP fixture received and delivered test messages from both imported Mailspring accounts.");
  }
} catch (error) {
  if (container) {
    try {
      execFileSync("docker", ["logs", "--tail", "15", container], settings);
    } catch {
      // A container which failed during startup may already be gone.
    }
  }
  throw error;
} finally {
  const client = await readFile(clientId, "utf8").catch(() => "");
  if (client.trim()) {
    try {
      execFileSync("docker", ["rm", "-f", client.trim()], { stdio: "ignore", timeout: 30000 });
    } catch {
      // Docker already removes a client that exited normally.
    }
  }
  if (container) {
    try { docker(["stop", "--time", "1", container]); } catch {}
  }
  await rm(staging, { recursive: true, force: true });
}
