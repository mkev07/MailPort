# MailPort

**Set up once. Bring your accounts with you.**

MailPort is an MIT-licensed email account portability toolkit: a portable email
account vault with an open account provisioning SDK. Store account settings and
credentials once, then set up selected accounts in compatible email clients.

- **MailPort Vault** — where users securely store accounts, credentials, and connection settings.
- **MailPort SDK** — what developers integrate to support account imports.
- **Import from MailPort** — the action inside a compatible email client.

## Current status

Early developer prototype. This repository contains a Node.js/TypeScript SDK, a Tauri desktop vault prototype using shell-zero,
a Rust encryption/storage core, a draft account/vault specification, tests and
synthetic examples. The vault supports create/unlock/lock, account editing,
five sample accounts and explicit selected-account encrypted export. It has
**no authenticated app-to-app transfer protocol, provider login implementation,
mail-server connectivity checks or real email client integration yet**. The encryption implementation has not had an independent
security review. Use synthetic accounts while evaluating this prototype.

The package is private to prevent accidental publication; `@mailport/sdk` is a
proposed package name, not a claim that the npm scope is available.

## Run locally

Requires Node.js 22 or newer. Desktop development also requires a recent stable Rust toolchain and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci
npm run check
```

`check` verifies the SDK, runs its tests and synthetic example, and type-checks/builds the desktop frontend. No mail servers are contacted.

```sh
npm run check:rust
npm run check:compatibility
npm run vault:dev
```

Rust tests exercise encryption, storage and selection. The compatibility check reads Rust-generated packages in Node and Node-generated packages in Rust. These are independent language implementations, not two email clients.

```text
apps/vault/          Desktop application, based on shell-zero
packages/sdk/        Node.js/TypeScript SDK
packages/vault-core/ Rust crypto, validation and file storage
docs/                Draft specification, threat model and public vector
```

See [desktop development and acceptance](apps/vault/README.md).

## Developer example

```ts
import {
  unlockVault,
  listAccounts,
  importAccounts,
  type ImportAdapter,
} from '@mailport/sdk';

// Host-provided package reader and UI. Read a selected export, not the master vault.
const accounts = await unlockVault(await readSelectedPackage(), await promptForExportPassword());
const approvedAccountIds = await showAccountPicker(listAccounts(accounts));

if (approvedAccountIds.length > 0) {
  const adapter: ImportAdapter = {
    async configureAccount(account) {
      // Persist into the receiving client's settings and secure credential store.
      // Leave OAuth authentication pending for the client's own sign-in flow.
      await client.saveAccount(account);
    },
  };
  const results = await importAccounts({ accounts, approvedAccountIds, adapter });
  showImportResults(results);
}
```

This is an integration sketch, with host-provided UI and persistence functions.
See [the runnable example](packages/sdk/examples/roundtrip.ts) for a complete synthetic program.

**SDK trust boundary:** the Node reference SDK runs in one process. The process that unlocks
the vault can read every unlocked account. Account selection filters calls to the
adapter; it does not sandbox application code. The desktop app keeps unlocked account credentials in Rust-managed state and returns summaries or password-redacted edit fields to its webview. New credentials and passphrases necessarily pass through UI input and IPC. Direct app-to-app transfer must eventually send only approved accounts over an authenticated channel. Never send the full vault to a client when the user selected a subset.

## Authentication and import behavior

Password and app-password accounts can be configured together. The adapter owns
credential storage and account setup. `configured` means that the adapter resolved
successfully; it does not prove a server connection, successful authentication,
or delivered mail.

OAuth affects Google, Microsoft, and other providers. MailPort stores a provider
identifier and connection settings, not access or refresh tokens. Imported OAuth
accounts return `needs-sign-in`; the receiving client must use its own supported
provider authorization flow. Providers can also require app passwords or disallow
password authentication entirely.

Each account produces `configured`, `needs-sign-in`, `failed`, or `cancelled`.
Imports are sequential and allow partial success. Cancellation stops subsequent
accounts; it does not roll back completed saves or interrupt an active save.
Adapters must handle duplicate imports and credential-store failures appropriately.

## Security boundaries

- Vault metadata and credentials are encrypted together with AES-256-GCM.
- A fresh salt and nonce are generated for each seal; scrypt derives the key.
- The draft fixes KDF parameters and bounds file sizes before deriving keys.
- Passwords must be 12 or more JavaScript string code units and at most 1,024 UTF-8 bytes. Length alone does not guarantee a strong passphrase.
- Account validation requires TLS or STARTTLS and rejects unknown fields, including OAuth tokens.
- SDK import results contain IDs and statuses, never raw adapter error messages.
- Credentials exist in process memory after unlock. JavaScript cannot guarantee complete memory erasure.
- Approved clients can retain passwords. Vault access revocation cannot erase those copies; revoke app passwords or change credentials at the provider.
- Clipboard transfer, credentials in URLs, plaintext export, cloud synchronization, and mail proxying are outside this prototype. The desktop prototype exports selected accounts as an encrypted file protected by a separate password.

See [the draft specification](docs/specification.md) and
[the threat model](docs/security.md) before integrating.

## Roadmap and acceptance

The first product milestone is to store five accounts once and import selected
accounts into **two independently implemented email clients**. Today's example
uses two in-memory adapters, so it does not satisfy that milestone.

1. Review and stabilize the account schema and encrypted format, including additional cross-language conformance cases.
2. Harden the desktop vault prototype, including backups, password changes, OS lock/sleep integration and accessibility acceptance.
3. Define authenticated, replay-resistant transfer with recipient binding and verified application identity.
4. Integrate one actual client, then a second independent client implementation.
5. Verify provider sign-in, connection failures, duplicate handling, cancellation, secure persistence and recovery on supported platforms.
6. Obtain independent security review before recommending real credential storage.

Server discovery can later reuse Thunderbird autoconfiguration infrastructure.
Discovery must never send account passwords to an autoconfiguration service.

## Related work

See [research notes](docs/research.md) for adjacent projects and scope distinctions.
These are leads supplied during project planning, not independently reverified
findings or a claim that no equivalent exists.

## Contributing and license

Run `npm run check` before submitting a change. Use synthetic credentials in code,
issues, examples and logs. Protocol changes must update the specification and
compatibility tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

MailPort is licensed under the [MIT license](LICENSE).
