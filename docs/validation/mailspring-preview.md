# Mailspring integration preview

The local synthetic preview targets Mailspring commit
`0635d327398c8d97255660ae7b0011bf1e3fe4df`. The
[setup instructions](../../integrations/mailspring/README.md) explain how to
prepare a separate checkout and run the tests.

An earlier manual Vault-to-Mailspring transfer of two synthetic accounts
verified both comparison codes, macOS approval, selection, secure credential
read-back, cancellation of file dialogs and rejection of an expired request.
A separate running-app probe reproduced upstream configuration writes returning
without disk persistence. The older adapter made separate writes for credentials
and the account record. A failure of the second write could leave encrypted
credentials without an account.

The current preview writes the encrypted credentials, account record and account
version in a single replacement of `config.json`. The staging file is flushed
before replacement and the parent directory is synced where supported. A fresh
request can skip an exact persisted match and continue the import. Conflicting
credentials are preserved, and the preview rejects a stale credential snapshot
when another writer updates it during encryption. Older preview profiles with a
pending marker can recover a credential-only import through a new user-approved
transfer when both saved credentials match exactly.

The macOS synthetic UI checks cover a successful two-account import, a write
error and retry, process termination on both sides of replacement, recovery of a
matching legacy orphan, rejection of a conflicting orphan, and preservation of
another credential update during import. They check
persisted account records and encrypted credential read-back without printing
passwords. All seven also passed from a clean Apple Silicon macOS checkout with
independently installed dependencies using Node.js 22.22.3 and npm 10.9.8.
The upstream prebuilt Mailsync binary requires `mailspring` in its executable
path. A checkout without that name stopped during startup with exit code 2.

All seven cases also passed on Debian 13 ARM64 in Docker with Xvfb, a D-Bus
session, and an unlocked GNOME Keyring. The clean install compiled SQLite with
Clang 19 for Electron 44.11.4 and used upstream's prebuilt Mailsync. Debian 12
could compile the SQLite module with Clang 16, but its glibc was too old for
that Mailsync binary and the app did not reach the import screen.

These tests simulate process termination. Power loss, Windows runtime behavior,
live mailbox connectivity, OAuth, distribution and independent security review
remain unverified.
