// macOS preview only. Run with the Mailspring checkout's Electron executable.
// This accepts only the isolated synthetic profile used by the UI acceptance test.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const profile = '/tmp/mailport-mailspring-e2e';
app.setName('Mailspring');
app.setPath('userData', profile);
app.whenReady().then(async () => {
  try {
    const config = JSON.parse(fs.readFileSync(`${profile}/config.json`, 'utf8'))['*'];
    const accounts = config.accounts || [];
    const expected = ['sample1@example.com', 'sample2@example.com'];
    if (accounts.length !== 2 || !expected.every(email => accounts.some(a => a.emailAddress === email))) {
      throw new Error('The isolated profile does not contain exactly the expected samples.');
    }
    const decrypted = await safeStorage.decryptStringAsync(Buffer.from(config.credentials.data));
    const secrets = JSON.parse(decrypted.result);
    const ok = [1, 2].every(i => ['imap', 'smtp'].every(protocol =>
      secrets[`sample${i}@example.com-${protocol}`] === `PUBLIC-SYNTHETIC-PASSWORD-${i}`));
    console.log(ok ? 'Synthetic credential read-back passed.' : 'Synthetic credential read-back did not match.');
    app.exit(ok ? 0 : 1);
  } catch {
    console.error('Synthetic credential read-back could not be completed.');
    app.exit(1);
  }
});
