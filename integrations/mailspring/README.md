# Mailspring integration preview

This is a local, synthetic-data proof of concept, not an official Mailspring
plugin or a release for real accounts. `preview.patch` contains changes against
Mailspring and is provided under Mailspring's GPL-3.0 license. The generated SDK
bundle includes MailPort and third-party dependencies; review their licenses and
attribution before distributing it.

## Prepare a local checkout

Install MailPort's dependencies with `npm ci`. Obtain a separate, clean
Mailspring checkout at commit `0635d327398c8d97255660ae7b0011bf1e3fe4df`.
Include `mailspring` in the checkout directory name. The upstream prebuilt
Mailsync executable checks its path and exits with code 2 if the name is
missing. Then run from the MailPort root:

```sh
node integrations/mailspring/prepare-preview.mjs /path/to/Mailspring
```

The script checks the exact commit and clean working tree, applies the preview
patch, and builds its local SDK bundle. It builds the bundle before applying the
patch and refuses to overwrite an existing bundle. If applying or copying fails,
inspect the checkout before retrying; it may contain a partially prepared preview.
The patch includes a test-only onboarding
bypass and disables automatic login-item changes only when `MAILPORT_PREVIEW=1`.
It must not be enabled for real credentials or merged upstream as-is.

Install dependencies from inside the Mailspring checkout. The clean macOS
setup used Node.js 22 and npm 10.9.8 for both the root install and the nested
install that runs during `postinstall`:

```sh
npx --yes --package npm@10.9.8 -c 'npm ci --no-audit'
```

Run the preview with a dedicated configuration directory:

```sh
env -u ELECTRON_RUN_AS_NODE MAILPORT_PREVIEW=1 npm start -- --config-dir-path /tmp/mailport-mailspring-e2e
```

This starts a separate profile for synthetic password accounts. The preview
checks both transfer codes and saves each account record with its encrypted IMAP
and SMTP credentials in one configuration replacement. It does not test mail
server connectivity. OAuth accounts and conflicting accounts or credentials
are refused.

If a save fails while the request is still open, retry the same package after
resolving the storage error. After Mailspring restarts, create a new request and
export the same account selection again. An account counts as already saved
only when its record and both credentials match. The import leaves that account
intact and continues with the remaining accounts.

For profiles interrupted by an older preview, a new, approved transfer can
rebuild a missing account using the existing encrypted entries if both passwords
match exactly and the old pending marker is present. Other entries are preserved.
The old marker can stay in place. The current importer does not use it to block
the profile. See the [validation notes](../../docs/validation/mailspring-preview.md)
for the observed behavior and limits.

## Synthetic UI checks

Close any other development preview running from the same Mailspring checkout.
Build the Rust sender with `cargo build -p mailport-core --example compatibility`.
Then run these checks from the MailPort root with the prepared Mailspring
checkout's dependencies installed:

```sh
for case in success write-error crash-before crash-after legacy-orphan credential-conflict credential-race; do
  node integrations/mailspring/check-import-ui.cjs /path/to/Mailspring "$case" || exit
done
```

In PowerShell, run each case and stop on the first failure:

```powershell
'success', 'write-error', 'crash-before', 'crash-after', 'legacy-orphan', 'credential-conflict', 'credential-race' | ForEach-Object {
  node integrations/mailspring/check-import-ui.cjs 'C:\src\Mailspring' $_
  if ($LASTEXITCODE -ne 0) { throw "Mailspring check failed: $_" }
}
```

Each check uses its own temporary profile. The crash cases kill only their own
Electron process just before or just after replacing the configuration file.
They relaunch Mailspring and complete the import using a fresh transfer.
On Linux, use a desktop session or a virtual display with an unlocked Secret
Service keyring. The preview rejects Electron's insecure fallback storage.
The pinned Linux ARM64 Mailsync download needs glibc 2.38 or newer. Debian 12
ships glibc 2.36, so use a newer distribution for that binary. When SQLite
must compile against Electron 44, set `CC=clang CXX=clang++` for the npm install
with a recent Clang toolchain.

## Credential read-back from the isolated test profile

After importing the two unmodified Vault sample accounts into the dedicated
`/tmp/mailport-mailspring-e2e` profile, run the following from the Mailspring
checkout, replacing the script path with the absolute path in your MailPort
checkout. It compares the synthetic credentials without displaying them:

```sh
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron /path/to/MailPort/integrations/mailspring/verify-synthetic-credentials.cjs
```
