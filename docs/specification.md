# MailPort draft specification, version 1

Status: experimental. Version 1 is a development format, not a stable public
interoperability commitment. The Node reference SDK requires Node.js 22+. A separate Rust implementation now powers the desktop prototype; both directions are covered by compatibility checks. Other platforms still need their own implementation and verification.

## Account model

An account has exactly these fields; unknown fields are rejected:

| Field | Meaning |
| --- | --- |
| `id` | UUID, unique within the vault; stable across edits |
| `email` | Email address, at most 320 characters |
| `displayName` | Display name, at most 256 characters; may be empty |
| `incoming` | IMAP server object |
| `outgoing` | SMTP server object |

Each server contains `host` (ASCII DNS-style hostname or IPv4 address, max 253
characters), `port` (integer 1–65535), `security` (`tls` for implicit TLS or
`starttls` for required upgrade), `username` (1–320 characters), and `auth`.
Unicode hostnames must be converted to ASCII IDNA before storage. IPv6 literals,
POP3, unauthenticated SMTP, client certificates and arbitrary provider extensions
are not supported in this draft. Host validation is syntactic, not proof of DNS,
provider ownership or reachability.

Authentication is one of:

```json
{"type":"password","password":"synthetic-example-only"}
```

```json
{"type":"oauth","providerId":"example-provider"}
```

Passwords/app passwords have 1–4,096 characters. OAuth objects contain no tokens,
client secrets or OAuth client IDs. `providerId` is a nonempty identifier of at most
128 characters; receiving clients must explicitly map supported providers.
Incoming and outgoing authentication may differ. Provider discovery and OAuth
endpoint selection are outside the account schema.

A vault contains up to 100 accounts. An empty vault is valid. Duplicate addresses
are allowed because multiple configurations may share an address; duplicate IDs
are rejected. See `packages/sdk/src/schema.ts` for executable validation, including the email
and UUID parsers used by this implementation.

## Encrypted envelope

The serialized file is a UTF-8 JSON object with exactly these fields:

```json
{
  "format": "mailport-vault",
  "version": 1,
  "suite": "scrypt-n32768-r8-p1-aes256gcm",
  "salt": "base64 of 16 random bytes",
  "nonce": "base64 of 12 random bytes",
  "ciphertext": "base64 of encrypted payload",
  "tag": "base64 of 16 authentication bytes"
}
```

The example above is descriptive; its base64 placeholders are not valid files.
All byte fields use standard padded RFC 4648 base64 without whitespace.

1. Validate the envelope and enforce a 4 MiB serialized UTF-8 size limit before KDF work.
2. Encode the passphrase as UTF-8 without Unicode normalization. The reference requires at least 12 UTF-16 code units and at most 1,024 UTF-8 bytes. Other implementations must preserve this behavior for compatibility.
3. Derive 32 key bytes with scrypt, N = 32,768, r = 8, p = 1, using the decoded salt. The reference caps scrypt memory at 64 MiB.
4. Encrypt the UTF-8 JSON payload `{"accounts":[...]}` using AES-256-GCM, the derived key, and the decoded nonce.
5. Use the exact UTF-8 additional authenticated data `MailPort:1:scrypt-n32768-r8-p1-aes256gcm` (no newline).
6. Store the ciphertext and the full 16-byte tag separately.
7. During unlock, verify authentication before parsing or returning payload data. Validate the decrypted payload and every account.

Salt and nonce must be independently generated from the platform cryptographic
random generator on every seal. Do not reuse them. Unknown versions/suites are
rejected; no fallback or caller-controlled KDF work factor is permitted. JSON
property order and whitespace are not significant. Payload object keys beyond
`accounts` are rejected.

The suite and version are authenticated through the fixed AAD; altered salt,
nonce, ciphertext or tag prevents successful authentication. Outer metadata still
reveals format, size and KDF suite. This does not prevent replacement with an
older valid vault or offline passphrase guessing.

## SDK contract

- `sealVault(accounts, password)` validates and encrypts, returning serialized JSON.
- `unlockVault(serialized, password)` validates and authenticates, returning accounts.
- `listAccounts(accounts)` returns only ID, email, display name and `requiresSignIn` for selection UI.
- `importAccounts({ accounts, approvedAccountIds, adapter, signal? })` snapshots inputs, validates the entire selection before invoking the adapter, and configures selected accounts sequentially in selection order.

An empty, unknown or duplicate selection fails without disclosing any accounts
to the adapter. UI cancellation should skip the import call. `configureAccount`
receives one selected account including its credentials. The trusted host must
obtain approval before calling this API. The API does not authenticate the
receiving application or prove user consent.

Results contain only `accountId` and one status:

| Status | Meaning |
| --- | --- |
| `configured` | Adapter save resolved; both servers use password authentication |
| `needs-sign-in` | Adapter save resolved; at least one server requires OAuth |
| `failed` | Adapter threw/rejected; no promise that partial persistence was undone |
| `cancelled` | Abort observed before this account's adapter invocation |

An active adapter call is not interrupted. There is no implicit transaction,
retry, connectivity test, deduplication or rollback. The client adapter owns those
policies and must document them. Generic error codes are `INVALID_ACCOUNTS`,
`INVALID_VAULT`, `UNLOCK_FAILED`, `INVALID_PASSWORD`, and `INVALID_SELECTION`.
Wrong passphrases and authenticated-content failures share `UNLOCK_FAILED`.

## Transfer protocol: deliberately pending

The encrypted vault is a storage format. It is not a complete cross-process import
protocol. Do not treat a vault password as an application authorization token.
A client receiving the whole vault and password can read every account in it.

A future transfer specification must define recipient identity verification,
user-visible account scope, authenticated encrypted channels, recipient binding,
expiration, replay prevention, cancellation and pairing recovery. URLs may carry
non-secret routing identifiers only. Never put vaults, passwords or transferable
bearer credentials in ordinary URLs, clipboard contents, telemetry or logs.

## Public test vector

[The v1 known-answer vector](vectors/v1.json) includes its public synthetic
passphrase, expected accounts, and encrypted envelope. It was created directly
with Node's crypto primitives and is tested against the SDK decoder. Its fixed
salt and nonce are for this one public vector only. Never reuse them for real
vaults. The Rust implementation also reads this vector. This does not claim independent email-client interoperability.

## Rust reference implementation and file export

`packages/vault-core` implements the suite independently using RustCrypto scrypt
and AES-GCM. `npm run check:compatibility` tests both directions between Rust and
Node, including a selected two-of-five account package. Rust reads the public
known-answer vector in unit tests. This does not establish compatibility with
independent email clients.

Desktop exports use the same v1 encrypted envelope, re-encrypting only approved
accounts with a separate passphrase, salt and nonce. They are ordinary encrypted
files, without recipient authentication or replay protection. The master vault
must not be shared when only a subset was approved. Direct app-to-app transport
remains unspecified.
