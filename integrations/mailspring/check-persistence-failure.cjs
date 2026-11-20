// Runs only against a new temporary Mailspring profile; no mailbox or secrets are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
  const checkout = process.argv[2];
  if (!checkout) throw new Error('Provide the prepared Mailspring checkout path.');
  const root = fs.realpathSync(checkout);
  const localRequire = createRequire(path.join(root, 'package.json'));
  const { _electron } = localRequire('playwright');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mailport-persistence-test-'));
  let app;
  try {
    const env = { ...process.env, MAILPORT_PREVIEW: '1', PLAYWRIGHT: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({
      executablePath: localRequire('electron'),
      args: [path.join(root, 'app'), '--dev', '--config-dir-path', profile],
      env,
      timeout: 30000,
    });
    await app.firstWindow({ timeout: 30000 });
    const result = await app.evaluate(async (_electron, expectedProfile) => {
      const fs = process.getBuiltinModule('node:fs');
      const path = process.getBuiltinModule('node:path');
      for (let i = 0; i < 100 && !global.application?.configPersistenceManager; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      const manager = global.application.configPersistenceManager;
      if (manager.configDirPath !== expectedProfile) throw new Error('Unexpected Mailspring profile.');
      const originalPath = manager.configFilePath;
      const before = fs.readFileSync(originalPath, 'utf8');
      const originalDialog = manager._showSaveErrorDialog;
      manager._showSaveErrorDialog = () => 'ignore';
      manager.configFilePath = path.join(originalPath, 'impossible', 'config.json');
      let returned = false;
      try {
        manager.setRawValue('mailportPersistenceProbe', 'synthetic', -1);
        returned = true;
      } finally {
        manager.configFilePath = originalPath;
        manager._showSaveErrorDialog = originalDialog;
      }
      return { returned, unchanged: fs.readFileSync(originalPath, 'utf8') === before };
    }, profile);
    assert.deepEqual(result, { returned: true, unchanged: true });
    console.log('Confirmed: a failed configuration write can return without persisting.');
  } finally {
    if (app) await app.close();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
