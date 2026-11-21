# Mailspring integration preview

This is a local developer preview for test accounts. It is independent of the
official Mailspring release. `preview.patch` contains changes against
Mailspring and is provided under Mailspring's GPL-3.0 license. The generated SDK
bundle includes MailPort and third-party dependencies; review their licenses and
attribution before distributing it.

## Prepare a local checkout

Install MailPort's dependencies with `npm ci`. Obtain a separate, clean
Mailspring checkout at commit `0635d327398c8d97255660ae7b0011bf1e3fe4df`.
On Windows, set `core.autocrlf=false` for the Mailspring checkout before
checking out that commit so the patch can match the upstream LF source.
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
bypass and disables automatic login-item changes only when the preview is enabled
for a development build with an explicit profile path.
Use a dedicated Mailspring profile and test mailboxes when evaluating this integration.

Install dependencies from inside the Mailspring checkout. The clean macOS
setup used Node.js 22 and npm 10.9.8 for both the root install and the nested
install that runs during `postinstall`:

```sh
npx --yes --package npm@10.9.8 -c 'npm ci --no-audit'
```

Run the preview with a dedicated configuration directory:

```sh
env -u ELECTRON_RUN_AS_NODE npm start -- --mailport-preview --config-dir-path /tmp/mailport-mailspring-e2e
```

This starts a separate profile for synthetic password accounts. The file transfer route
checks both transfer codes. Both routes save each account record with its encrypted IMAP
and SMTP credentials in one configuration replacement. It does not test mail
server connectivity. Accounts that require OAuth appear under
**Sign in separately** for the current import screen. Add those accounts
through Mailspring's provider setup. The preview refuses conflicting accounts
and credentials.

### Direct import on Mac

1. Keep the Mailspring preview running.
2. Unlock MailPort Vault and choose **Link email app → Link Mailspring**.
3. Copy the **Request code** from Mailspring into MailPort. Select the accounts,
   then click **Approve import** in the right sidebar and confirm the macOS prompt.
4. Enter the **Transfer code** shown in MailPort into Mailspring and click
   **Import accounts**. Finish any provider sign-in in Mailspring.

You can also start from **Import from MailPort → Open MailPort** in Mailspring.
The apps exchange the encrypted package over a local socket. The request code
verifies which app session receives the accounts. The transfer code verifies
the package before Mailspring saves it. **Create import request** still starts
the encrypted file transfer route.

An identity test build can additionally pin a receiving app's macOS code-signing
requirement with `MAILPORT_DIRECT_RECEIVER_REQUIREMENT`. With a pin configured,
Vault rejects sockets that fail Apple's requirement check against the
kernel's peer audit token. The preview links a running Mailspring instance.

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
