# MailPort Vault desktop prototype

A Tauri 2 / React application adapted from Kevin's MIT-licensed
[shell-zero](https://github.com/mkev07/shell-zero) template. Attribution is retained
in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). App work belongs in MailPort;
the upstream template remains unchanged.

## Development

From the MailPort repository root:

```sh
npm ci
npm run check
npm run check:rust
npm run check:compatibility
npm run vault:dev
```

Requires Tauri platform prerequisites and a recent stable Rust toolchain. For a
macOS app bundle, run `npm run vault:build -- --bundles app`. Windows builds use
`--config src-tauri/tauri.windows.conf.json`; Linux builds use the Linux config.
Those native platforms must be built and exercised on their respective hosts.
The rename script inherited from shell-zero is not a production build step.

## Behavior

The vault is stored under Tauri's per-user application data directory for
`org.mailport.vault`, in `vault.mailport`. On macOS this is normally
`~/Library/Application Support/org.mailport.vault/vault.mailport`.

The Rust process owns the unlocked session and master passphrase. Account list
responses contain metadata only; edit responses omit saved password values.
Blank passwords when editing preserve existing passwords for the same server.
Passwords newly entered and passphrases pass through the webview/IPC; JavaScript
cannot guarantee erasure of every runtime copy. Inputs and forms are cleared on
successful submission, close, or lock where applicable.

Sessions lock after five minutes without interface activity. The UI reports
backend lock state on a short polling interval. This is not yet verified as an
OS sleep/session-lock integration. Quitting drops the in-memory session.
The app is single-instance on desktop to avoid competing writers.

Encrypted writes use a temporary file in the same directory followed by atomic
replacement. On Unix, the app directory is mode 0700 and encrypted files are mode
0600. Windows inherits per-user directory ACLs; Windows ACL acceptance is pending.
Creation uses a non-overwriting operation. There is no forgotten-passphrase reset,
backup rotation, password change or general vault migration UI yet.

Export is an explicitly approved file operation. Only selected accounts are
included and a different password from the master passphrase is required.
The native save dialog controls the destination. The master vault file cannot
be used as the export target. A selected package is re-encrypted with fresh salt
and nonce. File transfers are not recipient-bound or replay-resistant and are
not the planned authenticated direct app-to-app protocol. Whoever holds a package
and its password can retain the included credentials.

## Manual acceptance with synthetic data

1. Create a vault with a disposable test passphrase (at least 12 characters).
2. Use “Try five sample accounts”; verify four password accounts and one OAuth account.
3. Edit a display name and save without re-entering saved passwords.
4. Lock; check that accounts disappear. Try an incorrect passphrase, then unlock correctly.
5. Quit and reopen; verify the app starts locked and saved settings survive unlock.
6. Select two accounts and export. Check that the approval list shows exactly those two and warns about credential retention.
7. Cancel the native save dialog; verify that no success message is shown.
8. Export with a separate password. Use the SDK to unlock the synthetic package and confirm that exactly the selected accounts are present.
9. Confirm that modified packages and incorrect passwords fail to unlock.
10. Exercise keyboard navigation, Escape and focus return for both dialogs. Verify five-minute auto-lock and that reopening does not restore secret fields.

No mailboxes are contacted. “Password saved” means encrypted configuration exists,
not that a provider accepted it. Real client provisioning, server discovery,
provider OAuth, native signing/notarization and independent review remain pending.
