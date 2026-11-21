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

The mixed-transfer check verifies that the preview saves the password account
and displays the OAuth address under **Sign in separately**. The preview uses
that list for the current import screen. Provider sign-in happens through
Mailspring's regular account setup.
[Windows run with all eight scenarios](https://github.com/mkev07/MailPort/actions/runs/44751319648/job/136339646071)

All seven cases also passed on Debian 13 ARM64 in Docker with Xvfb, a D-Bus
session, and an unlocked GNOME Keyring. The clean install compiled SQLite with
Clang 19 for Electron 44.11.4 and used upstream's prebuilt Mailsync. Debian 12
could compile the SQLite module with Clang 16, but its glibc was too old for
that Mailsync binary and the app did not reach the import screen.

All seven cases passed on the GitHub Actions Windows Server 2022 runner at
`da72716`. The crash-after case verified that the restarted app could decrypt
the saved credentials and that a new transfer could resume without duplicating
the committed account. On Windows the preview waits for Chromium to write its
DPAPI-wrapped key before saving new encrypted credentials.
[Windows CI log](https://github.com/mkev07/MailPort/actions/runs/44730472305/job/136268617999)

## Mailspring 2.0 on macOS

The preview patch also applied to Mailspring 2.0 at
`0e97b0c354a0953d9d65fe8ad885973ff2fc9ec9`. On Apple Silicon macOS, the
synthetic UI harness verified a two-account import, separate sign-in handling
for an OAuth account, and recovery without duplication after the process
stopped following a committed write. The setup script still uses the earlier
baseline, which has broader recovery coverage.

### Live mail on macOS

On 2026-11-20, the project owner tested two MailPort-imported accounts in
the isolated Mailspring 2.0 preview on macOS. Mailspring synced existing mail
and received a new message sent from an external mailbox to both accounts.
The owner replied from each account in Mailspring and confirmed both replies
arrived in the external mailbox. This verifies live incoming and outgoing mail
for the two tested configurations. Restart persistence with these live accounts
was not reported.

## Direct handoff on macOS

The project owner confirmed starting **Open MailPort** in the Mailspring preview
and approving the import in MailPort Vault. The isolated Mailspring profile
contained four built-in sample accounts after the client quit. A fresh Electron
process using the Mailspring app identity verified both saved credentials for
each account through macOS secure storage. This exercises the direct handoff
without exchanging request or package files. The built-in samples use
placeholder servers, and this run did not check mail connectivity.

The encrypted file route also passed the two-account synthetic import check
with the same patched Mailspring checkout. The preview now permits real account
selection, but that updated direct handoff has not yet been validated with a
live mailbox. The default development build does not pin the receiving app's
code signature. A signing requirement can be configured for identity testing.

## Send and receive with controlled servers

The Mailspring preview on Debian 13 ARM64 imported two synthetic accounts,
restarted, and passed Mailsync's native IMAP and SMTP account check using
their saved credentials. The local SMTP fixture delivered a test message
from each account and Mailspring synced both messages sent earlier by
Thunderbird into the matching inbox database. The endpoints enforced IMAP
TLS and SMTP STARTTLS. The test CA was trusted inside the disposable Linux
container. The macOS engine rejected the fixture certificate when its CA
was absent from the system trust store.

Build the prepared Linux client from the committed preview, then pass that
image as the second argument to the [local mail harness](thunderbird-feasibility.md#send-and-receive-with-controlled-servers).

```sh
git archive HEAD | docker build -f integrations/mailspring/Dockerfile.local-mail \
  -t mailport-msp-fixture:local -
node integrations/thunderbird/local-mail/run.mjs /path/to/Thunderbird mailport-msp-fixture:local
```

Power loss, broader live provider compatibility, live OAuth sign-in,
distribution and independent security review remain unverified.
