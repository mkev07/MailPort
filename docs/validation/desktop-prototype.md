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

## Remaining acceptance

Windows and Linux native builds and runtime behavior have not been verified on
this Mac. CI includes native build jobs for both. Full VoiceOver/screen-reader,
keyboard-only end-to-end, zoom/contrast and real five-minute idle acceptance are
pending; only session expiry logic was exercised automatically. OS sleep/lock
integration, native release signing/notarization, independent security review,
provider compatibility and two real email clients remain release gates.

The preview vault contains only synthetic sample accounts. Its disposable
passphrase is `MailPort-demo-only-2026`. Never reuse this publicly documented
passphrase or add real credentials to that demo vault.
