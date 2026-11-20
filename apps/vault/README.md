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

Sessions lock after five minutes without interface activity. On macOS,
system sleep and user-session deactivation also lock the Vault, even when
the idle timer is paused. The UI reports backend lock state on a short
polling interval. Quitting drops the in-memory session. The app is
single-instance on desktop to avoid competing writers.

Encrypted writes use a temporary file in the same directory followed by atomic
replacement. On Unix, the app directory is mode 0700 and encrypted files are mode
0600. Windows inherits per-user directory ACLs; Windows ACL acceptance is pending.
Creation uses a non-overwriting operation. There is no forgotten-passphrase reset,
backup rotation, password change or general vault migration UI yet.

[File transfer](../../docs/transfer.md) requires an import request created by
the receiving client. MailPort shows the selected accounts and request code.
Approval opens the native save dialog and prompts macOS to authenticate the
device owner. Windows and Linux use explicit approval in the unlocked vault.
The saved package is encrypted to the request's public key. After saving,
MailPort shows a transfer code for the receiver to compare before import.

## Adding an account

Enter the email address first. MailPort checks built-in provider settings, IMAP
and SMTP submission DNS SRV records, and MX records for recognized hosting
providers. It can also read HTTPS autoconfiguration from the domain or the
Thunderbird provider directory. These lookups use only the domain. MailPort
does not contact the mail servers during setup. Domains without usable
settings can be configured manually.

By default both servers use the email address and one password or OAuth
provider. Open **Server settings** to change the ports, enter a shared
username, or configure separate logins. New accounts reuse the incoming hostname
for SMTP by default. Discovery can supply a separate SMTP hostname.
OAuth accounts still require sign-in through the receiving email client.

## Profiles

Use **Add profile** in the sidebar to create a group. Open an account and
choose its **Profile** to move it between groups. New accounts created while
viewing a profile join that profile. The vault encrypts profile names, avatars,
and assignments alongside accounts. Export packages contain only the selected
accounts and keep the same transfer format.

## Quick unlock on macOS

Open **Unlock settings** after unlocking with your master passphrase. Touch ID
stores a copy of the passphrase in the Mac’s Data Protection Keychain. The item
is device-only and requires a fingerprint from the current enrolled set.
Turning the option off removes the Keychain item. If enrollment changes, unlock
with the passphrase and set up Touch ID again.

An ad hoc build cannot use the Data Protection Keychain. Touch ID acceptance
requires a signed and provisioned build with access to the app's Keychain group.
The app reports the Keychain error and keeps passphrase unlock available.

For 1Password, install its CLI, enable desktop app integration in 1Password
and copy the secret reference for the field holding your master passphrase.
MailPort verifies the field before saving the reference. The password remains
in 1Password and passes to the native vault backend only when requested.
If the CLI has multiple accounts, configure its default account for the vault.

## Manual acceptance with synthetic data

1. Create a vault with a disposable test passphrase (at least 12 characters).
2. Use “Try five sample accounts”; verify four password accounts and one OAuth account.
3. Edit a display name and save without re-entering saved passwords.
4. Lock; check that accounts disappear. Try an incorrect passphrase, then unlock correctly.
5. Quit and reopen; verify the app starts locked and saved settings survive unlock.
6. Start the [demo receiver](../../docs/transfer.md#try-it-with-synthetic-accounts) and select two accounts in the vault. Open the request and compare its code.
7. Cancel the native save dialog and verify the request can still be used.
8. Approve and save. Open the package in the demo and check its transfer code against the vault. Confirm that the receiver reports two results.
9. Run `npm run check:compatibility` for wrong-recipient, retry and replay coverage.
10. Exercise keyboard navigation, Escape and focus return for both dialogs. Verify five-minute auto-lock and that reopening does not restore secret fields.

No mailboxes are contacted. “Password saved” means encrypted configuration exists,
not that a provider accepted it. Real client provisioning, provider OAuth, native signing/notarization and independent review remain pending.
