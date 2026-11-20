// Run with the Mailspring checkout's Electron executable and a bundled verifier.
// Reads only the isolated synthetic profile; never prints account secrets.
const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const { verifyMailPortAccount } = require(process.argv[2]);
const profile = '/tmp/mailport-mailspring-e2e';
app.setName('Mailspring');
app.setPath('userData', profile);
app.whenReady().then(async () => {
  try {
    const read = () => fs.promises.readFile(`${profile}/config.json`, 'utf8');
    const config = JSON.parse(await read())['*'];
    if (config.accounts.length !== 2) throw new Error('Unexpected sample profile');
    for (let i = 1; i <= 2; i++) {
      const email = `sample${i}@example.com`;
      const account = config.accounts.find(item => item.emailAddress === email);
      if (!account) throw new Error('Unexpected sample profile');
      const settings = account.settings;
      const password = `PUBLIC-SYNTHETIC-PASSWORD-${i}`;
      const source = {
        email,
        incoming: { host: settings.imap_host, port: settings.imap_port, username: settings.imap_username,
          security: settings.imap_security === 'SSL / TLS' ? 'tls' : 'starttls', auth: { password } },
        outgoing: { host: settings.smtp_host, port: settings.smtp_port, username: settings.smtp_username,
          security: settings.smtp_security === 'SSL / TLS' ? 'tls' : 'starttls', auth: { password } },
      };
      const decrypt = data => safeStorage.decryptStringAsync(data);
      if (!await verifyMailPortAccount(source, account.id, read, decrypt)) throw new Error('Snapshot mismatch');
      source.outgoing.auth.password = 'PUBLIC-SYNTHETIC-INCORRECT';
      if (await verifyMailPortAccount(source, account.id, read, decrypt)) throw new Error('Mismatch accepted');
    }
    console.log('Persisted synthetic snapshots passed; incorrect credentials rejected.');
    app.exit(0);
  } catch {
    console.error('Synthetic snapshot verification failed.');
    app.exit(1);
  }
});
