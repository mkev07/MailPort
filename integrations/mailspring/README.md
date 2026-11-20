# Mailspring integration preview

This is a local, synthetic-data proof of concept, not an official Mailspring
plugin or a release for real accounts. `preview.patch` contains changes against
Mailspring and is provided under Mailspring's GPL-3.0 license. The generated SDK
bundle includes MailPort and third-party dependencies; review their licenses and
attribution before distributing it.

## Prepare a local checkout

Install MailPort's dependencies with `npm ci`. Obtain a separate, clean
Mailspring checkout at commit `0635d327398c8d97255660ae7b0011bf1e3fe4df`, then
from the MailPort root run:

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

Install the Mailspring checkout's dependencies following its own instructions.
In this environment, npm 10 was needed because the checkout's nested install
failed under npm 11. Run the preview with a dedicated configuration directory:

```sh
env -u ELECTRON_RUN_AS_NODE MAILPORT_PREVIEW=1 npm start -- --config-dir-path /tmp/mailport-mailspring-e2e
```

This starts a separate profile. It can write to that directory and the system
credential store; use only the built-in sample accounts. It does not verify
connections to mail servers before saving an imported account. It rejects OAuth
and existing accounts. Before saving, the preview creates a profile-wide
pending marker that contains no account details. An interrupted or unverified
save leaves the marker in place and blocks subsequent imports, including after
restart. The preview has no automatic recovery: inspect the isolated profile
before removing the marker or starting another request.
It also refuses to overwrite existing IMAP, SMTP, or refresh-token credential
entries for the address, even if the corresponding account record is missing.
This check is not a transaction with other Mailspring operations.
Mailspring's save operation can return without confirming a successful disk
write. The preview checks the account settings and decrypted credentials in the
on-disk profile after saving; a mismatch or read failure is treated as an
uncertain save. This snapshot check is not a crash-safe transaction, and the
marker prevents an automatic retry but does not repair partial writes or prove
that Mailspring's own data survived a power failure. Recovery and cross-platform
validation remain release blockers for the integration.
Review the [validation notes](../../docs/validation/mailspring-preview.md) for
what was tested and the remaining work.

## Synthetic UI checks

Close other Mailspring instances first. Build the Rust compatibility example
with `cargo build -p mailport-core --example compatibility`, then run from
the MailPort root with the prepared checkout's dependencies installed:

```sh
node integrations/mailspring/check-import-ui.cjs /path/to/Mailspring
node integrations/mailspring/check-import-ui.cjs /path/to/Mailspring --fail-write
node integrations/mailspring/check-import-ui.cjs /path/to/Mailspring --fail-account
node integrations/mailspring/check-import-ui.cjs /path/to/Mailspring --orphan
```

Each run creates and removes its own temporary profile. The failure cases inject
write errors at the credential and account-record steps respectively and check
that a new import is blocked after restarting. They never use a real mailbox or
change a normal profile.
The orphan check deliberately removes the marker only in its controlled
temporary profile, then verifies that pre-existing synthetic credentials are
preserved and the import is refused.

## Credential read-back from the isolated test profile

After importing the two unmodified Vault sample accounts into the dedicated
`/tmp/mailport-mailspring-e2e` profile, run the following from the Mailspring
checkout, replacing the script path with the absolute path in your MailPort
checkout. It compares the synthetic credentials without displaying them:

```sh
env -u ELECTRON_RUN_AS_NODE ./node_modules/.bin/electron /path/to/MailPort/integrations/mailspring/verify-synthetic-credentials.cjs
```
