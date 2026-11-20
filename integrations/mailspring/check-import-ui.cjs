// Synthetic transfers and interruption tests against disposable profiles.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');

const root = fs.realpathSync(process.argv[2]);
const mode = process.argv[3] || 'success';
assert.ok(['success', 'write-error', 'crash-before', 'crash-after', 'legacy-orphan', 'credential-conflict', 'credential-race'].includes(mode));
const mailspring = createRequire(path.join(root, 'package.json'));
const { _electron } = mailspring('playwright');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mailport-ui-test-'));
const configPath = path.join(profile, 'config.json');
const interruptionPath = path.join(profile, 'test-interruption');
const binary = process.platform === 'win32' ? 'compatibility.exe' : 'compatibility';
const vector = require('../../docs/vectors/v1.json').accounts[0];
const sample = {
  ...vector,
  email: 'ui-sample@example.com',
  incoming: { ...vector.incoming, auth: { type: 'password', password: 'PUBLIC-SYNTHETIC-IMAP' } },
  outgoing: { ...vector.outgoing, auth: { type: 'password', password: 'PUBLIC-SYNTHETIC-SMTP' } },
};
const another = { ...sample, id: '00000000-0000-4000-8000-000000000002', email: 'second-ui@example.com' };
const env = { ...process.env, PLAYWRIGHT: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MAILPORT_PREVIEW;
let attempt = 0;
let app;
const rendererErrors = [];

function observeWindow(page) {
  const capture = message => {
    rendererErrors.push(String(message).slice(0, 1500));
    if (rendererErrors.length > 10) rendererErrors.shift();
  };
  page.on('pageerror', capture);
  page.on('console', message => {
    if (message.type() === 'error') capture(message.text());
  });
}

async function launch() {
  rendererErrors.length = 0;
  app = await _electron.launch({
    executablePath: mailspring('electron'),
    args: [path.join(root, 'app'), '--dev', '--mailport-preview', '--enable-logging', '--config-dir-path', profile],
    env, timeout: 30000,
  });
  app.on('window', observeWindow);
  for (const window of app.windows()) observeWindow(window);
  await app.firstWindow();
  await app.evaluate(async ({ app: electronApp }, expectedProfile) => {
    for (let i = 0; i < 100 && !global.application?.configPersistenceManager; i++) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (global.application.configPersistenceManager.configDirPath !== expectedProfile) {
      throw new Error('Unexpected profile');
    }
    if (global.mailPortPreviewEnabled !== true) {
      const diagnostics = {
        packaged: electronApp.isPackaged,
        devMode: global.application.devMode,
        previewFlag: process.argv.includes('--mailport-preview'),
        previewSwitch: electronApp.commandLine.hasSwitch('mailport-preview'),
        devFlag: process.argv.includes('--dev'),
        configFlag: process.argv.includes('--config-dir-path'),
        previewBootstrap: typeof global.mailPortPreviewEnabled,
      };
      throw new Error(`Preview mode did not start: ${JSON.stringify(diagnostics)}`);
    }
  }, profile);
}

function config() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))['*'];
}

async function importPage() {
  if ((config().accounts || []).length) {
    await app.evaluate(() => global.application.emit('application:add-account'));
  }
  for (let i = 0; i < 100; i++) {
    for (const page of app.windows()) {
      if (await page.getByRole('button', { name: 'Create import request' }).isVisible().catch(() => false)) return page;
      const choose = page.getByRole('button', { name: 'Import from MailPort' });
      if (await choose.isVisible().catch(() => false)) await choose.click();
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const windows = await Promise.all(app.windows().map(async page => ({
    title: await page.title().catch(() => ''),
    text: await page.locator('body').innerText({ timeout: 1000 }).then(text => text.slice(0, 800), () => ''),
  })));
  throw new Error(`MailPort import page did not open. Windows: ${JSON.stringify(windows)}. Renderer errors: ${JSON.stringify(rendererErrors)}`);
}

async function prepare(page, accounts) {
  attempt++;
  const request = path.join(profile, `test-${attempt}.mailport-request`);
  const transfer = path.join(profile, `test-${attempt}.mailport`);
  await app.evaluate(({ dialog }, files) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.request });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.transfer] });
  }, { request, transfer });
  await page.getByRole('button', { name: 'Create import request' }).click();
  await page.getByText('Request code:').waitFor();
  const result = spawnSync(path.join(__dirname, '../../target/debug/examples', binary), ['seal-transfer'], {
    input: JSON.stringify({ requestFile: fs.readFileSync(request, 'utf8'), accounts, ids: accounts.map(account => account.id) }),
    encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, 'Rust transfer generation failed');
  const sealed = JSON.parse(result.stdout);
  assert.ok((await page.getByText('Request code:').innerText()).includes(sealed.verificationCode));
  fs.writeFileSync(transfer, sealed.package, { mode: 0o600 });
  await page.getByRole('button', { name: 'Open .mailport file' }).click();
  await page.getByText('Transfer code:').waitFor();
  assert.ok((await page.getByText('Transfer code:').innerText()).includes(sealed.packageCode));
}

function importAccounts(page) {
  return page.getByRole('button', { name: 'Codes match · Import accounts' }).click();
}

async function assertSaved(accounts) {
  const persisted = config();
  assert.equal(persisted.accounts.length, accounts.length);
  for (const account of accounts) {
    const record = persisted.accounts.find(record => record.emailAddress === account.email);
    assert.ok(record);
    assert.equal(record.settings.imap_security, 'SSL / TLS');
    assert.equal(record.settings.smtp_security, 'STARTTLS');
    assert.ok(!('imap_password' in record.settings) && !('smtp_password' in record.settings));
  }
  const matches = await app.evaluate(async ({ safeStorage }, emails) => {
    const fs = process.getBuiltinModule('node:fs');
    const manager = global.application.configPersistenceManager;
    const settings = JSON.parse(fs.readFileSync(manager.configFilePath, 'utf8'))['*'];
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(settings.credentials.data));
    const keys = JSON.parse(decrypted.result);
    return emails.every(email => keys[`${email}-imap`] === 'PUBLIC-SYNTHETIC-IMAP' &&
      keys[`${email}-smtp`] === 'PUBLIC-SYNTHETIC-SMTP');
  }, accounts.map(account => account.email));
  assert.equal(matches, true);
}

async function interruptWrite() {
  await app.evaluate((_electron, { failure, marker }) => {
    const fs = process.getBuiltinModule('node:fs');
    const manager = global.application.configPersistenceManager;
    const rename = fs.renameSync;
    fs.renameSync = (source, destination) => {
      if (destination !== manager.configFilePath || !source.startsWith(`${destination}.mailport-`)) {
        return rename(source, destination);
      }
      fs.renameSync = rename;
      if (failure === 'write-error') throw new Error('Synthetic configuration write failure');
      if (failure === 'crash-after') rename(source, destination);
      fs.writeFileSync(marker, failure);
      process.kill(process.pid, 'SIGKILL');
    };
  }, { failure: mode, marker: interruptionPath });
}

async function main() {
  await launch();
  if (mode === 'legacy-orphan' || mode === 'credential-conflict') {
    await app.evaluate(async ({ safeStorage }, matching) => {
      const manager = global.application.configPersistenceManager;
      const keys = {
        'ui-sample@example.com-imap': 'PUBLIC-SYNTHETIC-IMAP',
        'ui-sample@example.com-smtp': matching ? 'PUBLIC-SYNTHETIC-SMTP' : 'PUBLIC-OTHER',
      };
      manager.setRawValue('credentials', (await safeStorage.encryptStringAsync(JSON.stringify(keys))).toJSON());
    }, mode === 'legacy-orphan');
    fs.writeFileSync(path.join(profile, 'mailport-import-pending'), 'MailPort preview import pending\n');
  }

  const page = await importPage();
  await prepare(page, mode === 'success' ? [sample, another] : [sample]);
  const before = fs.readFileSync(configPath, 'utf8');
  const credentials = config().credentials;

  if (mode.startsWith('crash-')) {
    await interruptWrite();
    const [exit] = await Promise.all([
      once(app.process(), 'exit', { signal: AbortSignal.timeout(35000) }),
      importAccounts(page).catch(() => {}),
    ]);
    const [code, signal] = exit;
    assert.equal(fs.readFileSync(interruptionPath, 'utf8'), mode);
    if (process.platform === 'win32') assert.ok(signal === 'SIGKILL' || (code !== null && code !== 0));
    else assert.equal(signal, 'SIGKILL');
    app = undefined;
    if (mode === 'crash-before') {
      assert.equal(fs.readFileSync(configPath, 'utf8'), before);
    } else {
      assert.equal(config().accounts[0].emailAddress, sample.email);
      assert.ok(config().credentials?.data);
    }

    await launch();
    assert.ok(!fs.readdirSync(profile).some(name => name.startsWith('config.json.mailport-')));
    if (mode === 'crash-after') await assertSaved([sample]);
    const retryPage = await importPage();
    await prepare(retryPage, [sample, another]);
    await importAccounts(retryPage);
    await retryPage.getByText('2 account(s) saved in the local profile.', { exact: false }).waitFor();
    await assertSaved([sample, another]);
    if (mode === 'crash-after') assert.equal(config().accounts.filter(item => item.emailAddress === sample.email).length, 1);
  } else {
    if (mode === 'write-error') await interruptWrite();
    if (mode === 'credential-race') {
      await app.evaluate(({ safeStorage }) => {
        const encrypt = safeStorage.encryptStringAsync.bind(safeStorage);
        safeStorage.encryptStringAsync = async plaintext => {
          safeStorage.encryptStringAsync = encrypt;
          const manager = global.application.configPersistenceManager;
          const unrelated = await encrypt(JSON.stringify({ 'other@example.com-imap': 'PUBLIC-OTHER' }));
          manager.replaceMailPortCredentials('null', unrelated.toJSON());
          return encrypt(plaintext);
        };
      });
    }
    await importAccounts(page);
    if (mode === 'write-error' || mode === 'credential-conflict') {
      await page.getByText('0 account(s) saved in the local profile.', { exact: false }).waitFor();
      assert.equal(fs.readFileSync(configPath, 'utf8'), before);
      if (mode === 'write-error') await importAccounts(page);
    }
    if (mode === 'credential-race') {
      await page.getByText('0 account(s) saved in the local profile.', { exact: false }).waitFor();
      assert.equal((config().accounts || []).length, 0);
      assert.ok(config().credentials?.data);
      await importAccounts(page);
    }
    if (mode !== 'credential-conflict') {
      const expected = mode === 'success' ? [sample, another] : [sample];
      await page.getByText(`${expected.length} account(s) saved in the local profile.`, { exact: false }).waitFor();
      await assertSaved(expected);
      if (mode === 'legacy-orphan') assert.deepEqual(config().credentials, credentials);
      if (mode === 'credential-race') {
        const preserved = await app.evaluate(async ({ safeStorage }) => {
          const data = global.application.configPersistenceManager.settings.credentials.data;
          const result = await safeStorage.decryptStringAsync(Buffer.from(data));
          return JSON.parse(result.result)['other@example.com-imap'] === 'PUBLIC-OTHER';
        });
        assert.equal(preserved, true);
      }
    }
  }
  console.log(`Mailspring synthetic import check passed (${mode}).`);
}

async function closePreview() {
  if (!app) return;
  const child = app.process();
  let timer;
  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Mailspring did not close within five seconds')), 5000);
      }),
    ]);
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit', { signal: AbortSignal.timeout(5000) });
      child.kill('SIGKILL');
      await exited;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  try {
    await closePreview();
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}).catch(error => { console.error(error.message); process.exitCode = 1; });
