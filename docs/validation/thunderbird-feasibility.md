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
headless Thunderbird process. The bundled browser SDK creates the
`.mailport-request` inside Thunderbird. The harness passes that file to the
Rust sender and returns the encrypted `.mailport` package over its privileged
loopback Marionette interface. The browser SDK verifies both comparison codes
programmatically and decrypts inside Thunderbird. The harness checks that a
wrong code prevents any account writes. Thunderbird creates the accounts using
its native setup backend. The harness removes the profile on exit.

## Build and run the temporary add-on

Build the SDK and package the extension from a repository checkout with
`zip` available. The package is written to
`dist/thunderbird/mailport-preview.xpi`.

```sh
npm run build --workspace @mailport/sdk
node integrations/thunderbird/build-extension.mjs
```

Use a new Thunderbird profile, start it offline, and set the boolean
preference `mailport.preview.enabled` to `true` in that profile. Load the
XPI through **Debug Add-ons** as a temporary add-on. This is a Thunderbird
Experiment with privileged access. Keep it in the disposable profile.
Use synthetic password accounts with an `@example.com` address,
`imap.example.test` as the incoming hostname and `smtp.example.test` as
the outgoing hostname.
[Thunderbird temporary installation guide](https://developer.thunderbird.net/add-ons/hello-world-add-on)

Close Thunderbird's first-run account setup tab if it is open, then choose
**Import from MailPort** from the toolbar. Create and
save a request, open it in MailPort Vault, and compare the request codes
before exporting. Select the exported transfer in Thunderbird and type
the transfer code displayed by MailPort Vault. The tab keeps the request
in memory for up to 15 minutes. If interrupted, create another request
and export the same accounts again.

To exercise the packaged add-on in a disposable offline profile, pass
the XPI as the second argument to the harness.

```sh
node integrations/thunderbird/check-transfer.mjs \
  /Applications/Thunderbird.app/Contents/MacOS/thunderbird \
  dist/thunderbird/mailport-preview.xpi
```

## Observed behavior on macOS

The recovery harness passed on Thunderbird 138.0.1 and the official
153.7.0 ESR macOS build. The preview uses Thunderbird's asynchronous login
lookup, which is available on both versions.

- The temporary XPI opened its import tab, disabled the flow on a profile
  with the preview preference off, and presented both verification codes.
  A wrong confirmation code left the login store untouched. Two synthetic
  accounts saved after the correct code, and all four credentials were read
  back after a restart.

## Send and receive with controlled servers

The Thunderbird ESR add-on also passed a local mail exchange on macOS.
After importing and restarting, each account sent a message to the other
over SMTP STARTTLS and fetched its incoming message over IMAP TLS.
Thunderbird used the saved logins after restart. The fixture requires TLS
and uses distinct usernames and passwords for IMAP and SMTP.

The harness uses Docker, OpenSSL, and an already built browser SDK.
It creates a short-lived test CA and trusts it only in the disposable
Thunderbird profile. Docker publishes both mail ports on loopback. The
fixture accepts delivery only to its two synthetic mailboxes.

```sh
npm run build --workspace @mailport/sdk
node integrations/thunderbird/local-mail/run.mjs /path/to/Thunderbird
```

The optional second argument runs the [Mailspring checks](mailspring-preview.md)
against the same fixture. This covers local protocol behavior. Live provider
compatibility and OAuth sign-in need separate validation.

## Recovery details

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

The temporary XPI exercises Experiment packaging. A public release would
require reviewing its unrestricted permission prompt, credential boundary,
and compatibility across Thunderbird releases.
