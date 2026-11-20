# Desktop prototype validation — 2026-11-18

Local host: macOS, Node.js 22.22.3, Rust 1.93.0. All account data used here was
synthetic. No provider sign-in, mailbox connection or message sending occurred.

## Automated verification

- SDK: 16 tests pass; TypeScript declarations and ESM build pass; five-account in-memory adapter example passes.
- Rust core: five tests pass for known-answer decoding, encryption, tamper/wrong-password handling, selected export, private atomic storage and input validation.
- Desktop session: unit test verifies that expired sessions are dropped and recent sessions remain.
- Bidirectional Rust/Node checks pass, including a selected two-of-five package and Unicode display names.
- Frontend type-check and production asset build pass.
- macOS debug app bundle builds with ad-hoc signing; strict signature verification passes after launch. This is not a notarized release.
- npm production dependency audit reports no known vulnerabilities at the time of this run. This is not a security review.

## Native application checks

- Created a local vault through the interface using a disposable synthetic passphrase.
- Added five sample accounts: four password accounts and one pending OAuth account.
- Edited the first account's display name with both password fields blank.
- Independently read the desktop vault with the Node SDK; verified that five accounts and both original server credentials were preserved.
- Selected the first and fifth accounts; approval showed exactly those addresses and the credential-retention warning.
- Exported through the native save dialog using a separate password.
- Cancelled a second native save dialog; the app returned to the account list without claiming a saved export, and focus returned to Export selected.
- Read that actual exported file with the SDK; verified exactly two accounts, preserved IMAP/SMTP passwords and pending OAuth. The master passphrase did not decrypt it.
- Verified Unix permissions: application data directory 0700, master vault and exported package 0600.
- Locked the vault; account list disappeared. An incorrect passphrase failed with a generic message.
- Quit and reopened the rebuilt app; it started locked and the five accounts plus saved edit survived correct unlock.
- Escape dismissed the editor and keyboard focus returned to its Edit button. The export dialog focused its password field and displayed accessible labels.

## Windows and Linux preview packaging

- Windows CI silently installed the NSIS package into a temporary directory
  and verified that the installed app opened a native window.
- On Ubuntu 24.04, CI launched the extracted Debian executable and the
  AppImage in extract-and-run mode. Each initialized a separate application
  profile under Xvfb and D-Bus and stayed running through the startup check.

The Windows and Linux jobs on `40fb45b` uploaded the
`mailport-vault-windows-preview` and `mailport-vault-linux-preview` artifacts.
[Hosted checks and downloads](https://github.com/mkev07/MailPort/actions/runs/44757263072)

## Windows laptop acceptance

The `40fb45b` NSIS preview installed and ran in the interactive Windows
desktop with a fresh MailPort profile and five synthetic accounts.

- Locking hid the accounts. The wrong passphrase was rejected. The app started
  locked after a restart, and unlocking restored all five accounts.
- The native file picker opened the SDK receiver's transfer request. Vault
  rejected the request while the device clocks were substantially out of sync.
  After the clocks were aligned, the request codes matched. Canceling the first
  save kept the request usable, and retrying produced a package.
- The SDK matched the exported package code and decoded exactly the two
  selected accounts. The password account retained both server credentials
  and the OAuth account still required provider sign-in.
- The vault owner could read the encrypted file. A separate standard Windows
  user was denied read access to that same file.

## Linux Debian package acceptance

The `d8947e6` Debian package from CI installed with `apt` on Ubuntu 24.04
amd64 under Docker emulation on Apple Silicon. The installed executable ran
under Xvfb and D-Bus with a fresh profile.

- Created an encrypted vault with five synthetic accounts. Locking hid the
  accounts and rejected a wrong passphrase. After restarting, the app
  required unlock and restored all five accounts.
- Opened the SDK request in the native GTK chooser and matched its code.
  Canceling the first save left the request usable. Retrying saved an
  encrypted package through the native dialog.
- The vault and exported package both had mode 0600. The SDK verified the
  displayed package code and decoded exactly the two selected accounts,
  preserving the IMAP and SMTP credentials and pending OAuth sign-in.

## Remaining acceptance

Use a disposable macOS user account or VM to launch the signed Vault, create
a synthetic vault, lock and unlock it, and approve and save a transfer through
the native dialog. On Linux, repeat the vault workflow from the AppImage
mounted with FUSE in a desktop session. Windows signing remains open.

Full VoiceOver/screen-reader,
keyboard-only end-to-end, zoom/contrast and real five-minute idle acceptance are
pending. Automated tests cover session expiry and the macOS notification
subscriptions for system sleep and session deactivation, including clearing a
paused session through the shared backend lock. To verify physical sleep and
user switching, unlock a synthetic vault, pause the idle timer, then sleep and
wake the Mac or switch away and back. Confirm the vault requires a fresh unlock
in both cases. A screen lock without sleep or a session switch requires
separate acceptance.

The [Apple Silicon release candidate](macos-release.md) passed Developer ID
signature and notarization checks. Fresh-install runtime acceptance, release
packaging on other targets, independent security review, and live provider
compatibility remain open. The Mailspring and Thunderbird
previews have imported synthetic accounts and sent and received messages
against controlled servers. Their distribution readiness remains open.

The preview vault contains only synthetic sample accounts. Its disposable
passphrase is `MailPort-demo-only-2026`. Never reuse this publicly documented
passphrase or add real credentials to that demo vault.
