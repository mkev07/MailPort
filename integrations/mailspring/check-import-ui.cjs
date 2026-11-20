// Synthetic end-to-end test. Uses a temporary profile and never prints secrets.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

async function main() {
  const root = fs.realpathSync(process.argv[2]);
  const requireMailspring = createRequire(path.join(root, 'package.json'));
  const { _electron } = requireMailspring('playwright');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mailport-ui-test-'));
  const request = path.join(profile, 'test.mailport-request');
  const transfer = path.join(profile, 'test.mailport');
  const orphanCheck = process.argv.includes('--orphan');
  const failKey = process.argv.includes('--fail-write') ? 'credentials' :
    process.argv.includes('--fail-account') || orphanCheck ? 'accounts' : null;
  let app;
  try {
    const env = { ...process.env, MAILPORT_PREVIEW: '1', PLAYWRIGHT: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: requireMailspring('electron'),
      args: [path.join(root, 'app'), '--dev', '--config-dir-path', profile], env, timeout: 30000 });
    await app.firstWindow();
    await app.evaluate(async ({ dialog }, files) => {
      for (let i = 0; i < 100 && !global.application?.configPersistenceManager; i++)
        await new Promise(resolve => setTimeout(resolve, 100));
      if (global.application.configPersistenceManager.configDirPath !== files.profile) throw new Error('Unexpected profile');
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.request });
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.transfer] });
      if (files.failKey) {
        const manager = global.application.configPersistenceManager;
        const originalSet = manager.setRawValue;
        const originalDialog = manager._showSaveErrorDialog;
        let failing = false;
        manager.setRawValue = (key, value, sender) => {
          if (key === files.failKey) failing = true;
          if (!failing) return originalSet(key, value, sender);
          const previous = manager.configFilePath;
          manager.configFilePath = `${previous}/invalid/config.json`;
          manager._showSaveErrorDialog = () => 'ignore';
          try { return originalSet(key, value, sender); }
          finally { manager.configFilePath = previous; manager._showSaveErrorDialog = originalDialog; }
        };
      }
    }, { profile, request, transfer, failKey });
    let page;
    for (let i = 0; i < 100 && !page; i++) {
      for (const candidate of app.windows()) {
        if (await candidate.getByRole('button', { name: 'Create import request' }).isVisible().catch(() => false)) {
          page = candidate;
          break;
        }
      }
      if (!page) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!page) throw new Error('MailPort import page did not open');
    await page.getByRole('button', { name: 'Create import request' }).click({ timeout: 30000 });
    await page.getByText('Request code:').waitFor();
    const vector = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/vectors/v1.json'), 'utf8'));
    const account = vector.accounts[0];
    account.email = 'ui-sample@example.com';
    account.incoming.auth = { type: 'password', password: 'PUBLIC-SYNTHETIC-IMAP' };
    account.outgoing.auth = { type: 'password', password: 'PUBLIC-SYNTHETIC-SMTP' };
    const result = spawnSync(path.join(__dirname, '../../target/debug/examples/compatibility'), ['seal-transfer'], {
      input: JSON.stringify({ requestFile: fs.readFileSync(request, 'utf8'), accounts: [account], ids: [account.id] }), encoding: 'utf8',
    });
    assert.equal(result.status, 0, 'Rust transfer generation failed');
    const sealed = JSON.parse(result.stdout);
    assert.ok((await page.locator('body').innerText()).includes(sealed.verificationCode));
    fs.writeFileSync(transfer, sealed.package, { mode: 0o600 });
    await page.getByRole('button', { name: 'Open .mailport file' }).click();
    await page.getByText('Transfer code:').waitFor();
    assert.ok((await page.locator('body').innerText()).includes(sealed.packageCode));
    await page.getByRole('button', { name: 'Codes match · Import accounts' }).click();
    if (failKey) {
      await page.getByText('A save may be incomplete.', { exact: false }).waitFor({ timeout: 30000 });
      assert.equal(fs.existsSync(path.join(profile, 'mailport-import-pending')), true);
      assert.ok((await page.locator('body').innerText()).includes('0 account(s) verified'));
      const diskState = await app.evaluate(async ({ safeStorage }, expectedProfile) => {
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        if (global.application.configPersistenceManager.configDirPath !== expectedProfile) throw new Error('Unexpected profile');
        const config = JSON.parse(fs.readFileSync(path.join(expectedProfile, 'config.json'), 'utf8'))['*'];
        if (!config.credentials?.data) return { hasCredentials: false, hasAccount: (config.accounts || []).length > 0 };
        const decrypted = await safeStorage.decryptStringAsync(Buffer.from(config.credentials.data));
        const secrets = JSON.parse(decrypted.result);
        return { hasCredentials: secrets['ui-sample@example.com-imap'] === 'PUBLIC-SYNTHETIC-IMAP' &&
          secrets['ui-sample@example.com-smtp'] === 'PUBLIC-SYNTHETIC-SMTP', hasAccount: (config.accounts || []).length > 0 };
      }, profile);
      assert.deepEqual(diskState, { hasCredentials: failKey === 'accounts', hasAccount: false });
      await app.close();
      // Only this controlled temporary profile is modified: simulate an operator
      // clearing a marker while leaving the known synthetic orphan in place.
      if (orphanCheck) fs.unlinkSync(path.join(profile, 'mailport-import-pending'));
      app = await _electron.launch({ executablePath: requireMailspring('electron'),
        args: [path.join(root, 'app'), '--dev', '--config-dir-path', profile], env, timeout: 30000 });
      await app.firstWindow();
      const markerSurvived = await app.evaluate(async (_electron, expectedProfile) => {
        const fs = process.getBuiltinModule('node:fs');
        const path = process.getBuiltinModule('node:path');
        for (let i = 0; i < 100 && !global.application?.configPersistenceManager; i++)
          await new Promise(resolve => setTimeout(resolve, 100));
        const manager = global.application.configPersistenceManager;
        if (manager.configDirPath !== expectedProfile) throw new Error('Unexpected profile');
        return fs.existsSync(path.join(expectedProfile, 'mailport-import-pending'));
      }, profile);
      assert.equal(markerSurvived, !orphanCheck);
      let retryPage;
      for (let i = 0; i < 100 && !retryPage; i++) {
        for (const candidate of app.windows()) {
          if (await candidate.getByRole('button', { name: 'Create import request' }).isVisible().catch(() => false)) {
            retryPage = candidate;
            break;
          }
        }
        if (!retryPage) await new Promise(resolve => setTimeout(resolve, 250));
      }
      if (!retryPage) throw new Error('MailPort import page did not reopen');
      if (orphanCheck) {
        const retryRequest = path.join(profile, 'orphan.mailport-request');
        const retryTransfer = path.join(profile, 'orphan.mailport');
        await app.evaluate(({ dialog }, files) => {
          dialog.showSaveDialog = async () => ({ canceled: false, filePath: files.request });
          dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [files.transfer] });
        }, { request: retryRequest, transfer: retryTransfer });
        const before = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'))['*'].credentials;
        await retryPage.getByRole('button', { name: 'Create import request' }).click();
        await retryPage.getByText('Request code:').waitFor();
        const retry = spawnSync(path.join(__dirname, '../../target/debug/examples/compatibility'), ['seal-transfer'], {
          input: JSON.stringify({ requestFile: fs.readFileSync(retryRequest, 'utf8'), accounts: [account], ids: [account.id] }), encoding: 'utf8',
        });
        assert.equal(retry.status, 0, 'Rust transfer generation failed');
        const retryPackage = JSON.parse(retry.stdout);
        assert.ok((await retryPage.locator('body').innerText()).includes(retryPackage.verificationCode));
        fs.writeFileSync(retryTransfer, retryPackage.package, { mode: 0o600 });
        await retryPage.getByRole('button', { name: 'Open .mailport file' }).click();
        await retryPage.getByText('Transfer code:').waitFor();
        assert.ok((await retryPage.locator('body').innerText()).includes(retryPackage.packageCode));
        await retryPage.getByRole('button', { name: 'Codes match · Import accounts' }).click();
        await retryPage.getByText('existing account or credentials', { exact: false }).waitFor({ timeout: 30000 });
        const after = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'))['*'];
        assert.deepEqual(after.credentials, before);
        assert.equal((after.accounts || []).length, 0);
        assert.equal(fs.existsSync(path.join(profile, 'mailport-import-pending')), false);
        console.log('Existing orphaned credentials were preserved and the UI import was rejected.');
        return;
      }
      await retryPage.getByText('A previous import may be incomplete.', { exact: false }).waitFor({ timeout: 30000 });
      assert.equal(await retryPage.getByRole('button', { name: 'Create import request' }).isDisabled(), true);
      console.log('Injected write failure remained unverified; the pending marker blocked request creation after restart.');
      return;
    }
    await page.getByText('1 account(s) verified in the local profile.', { exact: false }).waitFor({ timeout: 30000 });
    const stored = JSON.parse(fs.readFileSync(path.join(profile, 'config.json'), 'utf8'))['*'];
    assert.equal(stored.accounts.length, 1);
    assert.equal(stored.accounts[0].emailAddress, account.email);
    assert.equal(fs.existsSync(path.join(profile, 'mailport-import-pending')), false);
    console.log('Synthetic Rust-to-Mailspring UI import and persisted snapshot verification passed.');
  } finally {
    if (app) await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
