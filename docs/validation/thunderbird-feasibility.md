# Thunderbird integration feasibility

## Account creation API

The local Thunderbird 138.0.1 and official 153.7.0 ESR builds both bundle
`chrome/messenger/content/messenger/schemas/accounts.json`. The namespace
exposes account listing, lookup, default identity operations and account events,
with no account creation operation in the `accounts` namespace. The current
public documentation likewise exposes account reads and events.
[Thunderbird MailExtension accounts API](https://webextension-api.thunderbird.net/en/mv3/accounts.html)

Thunderbird's own setup flow uses the internal `CreateInBackend.sys.mjs`
module. It creates the servers and account, writes credentials via the login
manager, and saves preferences in separate operations. This preview records the
approved account settings and reserved login IDs before writing any credentials.
It saves both logins through Thunderbird's login manager and checks the saved
store before creating the account. The recovery file contains no passwords.
A regular MailExtension needs a public account-creation API. Thunderbird
documents Experiments as a way for an add-on to call privileged core APIs.
Installing one prompts the user to grant unrestricted access to Thunderbird
and the computer. An Experiment would need review for consent, credential
handling, version compatibility, and distribution. A public account-creation
API upstream would let a MailExtension avoid that privileged dependency.
[Thunderbird Experiment documentation](https://developer.thunderbird.net/add-ons/mailextensions/experiments)

## Run the synthetic proof

Install the repository dependencies, then run the harness with a local
Thunderbird executable and the Rust toolchain available.

```sh
npm ci
npm run build --workspace @mailport/sdk
node integrations/thunderbird/check-transfer.mjs /Applications/Thunderbird.app/Contents/MacOS/thunderbird
```

The harness creates an offline temporary profile and launches a dedicated
headless Thunderbird process. The Rust sender and Node SDK exchange
`.mailport-request` and `.mailport` files and verify both comparison codes
programmatically. The harness passes only its fixed synthetic fixtures to
Thunderbird through its privileged loopback Marionette interface. Thunderbird
creates the accounts using its native setup backend. The harness removes the
profile on exit. The proof covers the transfer protocol and the Thunderbird
adapter. A user-facing importer and an extension package remain future work.

## Observed behavior on macOS

The recovery harness passed on Thunderbird 138.0.1 and the official
153.7.0 ESR macOS build. The preview uses Thunderbird's asynchronous login
lookup, which is available on both versions.

- The two-account batch survived process termination between accounts. A new
  transfer skipped the first saved account and created the second. After a
  further restart, both IMAP and SMTP credentials matched through the
  Thunderbird login manager. The files contained encrypted login fields and
  no synthetic plaintext passwords.
- A transfer proposing a different SMTP password for a saved account failed
  without changing the existing logins.
- After Thunderbird was killed between saving the IMAP and SMTP logins, a
  newly approved matching transfer reused the original encrypted IMAP login,
  saved the SMTP login, and created exactly one account. Both previously
  imported accounts and their login records were preserved. A different
  account ID or a mismatched IMAP password left the partial state untouched.
  The completed account and both credentials survived another forced restart.

- Forced restarts also covered three account-write states. The first had saved
  SMTP settings and logins before Thunderbird's account setup began. The
  second had incoming-server and identity settings saved midway through native
  setup, before Thunderbird linked the account. The third had a complete
  account saved with its recovery record still present. Retrying each transfer
  produced one linked account and reused the original SMTP server. A server
  with a different ownership marker blocked the retry. During the mid-setup
  recovery, the preview removed the unlinked IMAP preferences created by the
  interrupted import. It preserved an unrelated preference branch with the
  same host and username, the recovered account, and both saved logins.
  The cleanup changes preferences only and leaves mail folders on disk.

These tests cover process termination at the exercised write boundaries.
Power-loss behavior and other partial states remain unverified.

## Path to an installable importer

Target a standard MailExtension for general distribution. The missing
Thunderbird API needs to support creating an IMAP account and its SMTP
configuration, persisting credentials in the Thunderbird login manager,
and returning a result that lets MailPort retry after an interrupted write.
The request and transfer codes still need explicit user confirmation in the
importer. Meanwhile, keep the privileged integration as a disposable-profile
test for the file protocol and account recovery.

An Experiment can exercise packaging earlier in a controlled preview. A
public release would require accepting its unrestricted permission prompt
and reviewing how the add-on keeps credentials and operations within the
import flow across Thunderbird releases.
