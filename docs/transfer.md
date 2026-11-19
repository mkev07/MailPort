# Passwordless MailPort file transfer

This is an experimental file protocol. It works offline using the request and
package files plus two comparisons on trusted displays or channels. Both apps
must keep the verification prompts visible until the comparison is complete.

1. The receiving client creates a fresh X25519 key pair, saves the public import
   request as `.mailportrequest`, and displays the request code. Keep the private
   key inside that receiving session.
2. In MailPort Vault, choose the accounts and open the request. Check the request
   code against the receiving client before approving the transfer. The displayed
   client name comes from the request and is verified by the same comparison.
3. MailPort saves an encrypted `.mailport` package and displays the transfer
   code. Open the package in the receiver and compare that code with the vault's
   before allowing the adapter to persist anything.

The codes are public fingerprints. They cannot decrypt a package. Compare them
on the two apps' screens or an already trusted channel, separate from the
untrusted file delivery path. A request or package accompanied by a code from
the same untrusted source provides no proof of its origin. This protocol does
not attest application identity. An installed client's trust and storage
policies remain the user's responsibility.

## Request file

UTF-8 JSON, up to 4 KiB, with exactly these members:

| Field | Definition |
| --- | --- |
| `format` | `mailport-import-request` |
| `version` | Integer `1` |
| `requestId` | 16 random bytes encoded as standard padded RFC 4648 base64 |
| `clientName` | 1–80 printable ASCII characters with no leading or trailing spaces |
| `expiresAt` | Integer UTC Unix time in seconds, 15 minutes from creation |
| `publicKey` | Raw 32-byte X25519 public key encoded as standard padded base64 |

Compute SHA-256 over the UTF-8 bytes of the format, version in decimal,
request ID, expiry in decimal, client name and public key, in that order,
joined by a single LF byte between fields. There is no terminating LF.
The request code is the first eight digest bytes rendered as uppercase hex in
four groups of four, separated by hyphens. Reject requests at or after expiry
and reject requests more than 930 seconds into the future on the sender.

## Transfer package

UTF-8 JSON, up to 4 MiB, with exactly these members:

| Field | Definition |
| --- | --- |
| `format` | `mailport-transfer` |
| `version` | Integer `1` |
| `requestId` | Exact ID from the import request |
| `enc` | 32-byte RFC 9180 encapsulated key as standard padded base64 |
| `ciphertext` | HPKE ciphertext including the 16-byte AEAD tag, as standard padded base64 |

Use [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180) base mode,
DHKEM(X25519, HKDF-SHA256) (0x0020), HKDF-SHA256 (0x0001) and AES-256-GCM
(0x0002). Use the UTF-8 bytes of `MailPort:transfer:1:` followed by the full
32-byte request digest as HPKE `info`. Use empty AEAD associated data and
seal exactly one message at sequence number zero per fresh sender context.
The encrypted message is UTF-8 JSON `{"accounts":[...]}` with one or more
approved accounts using the [account schema](specification.md#account-model).
It contains no profile groups, vault passphrase or OAuth tokens.

The transfer code is the first eight bytes of SHA-256 of the **exact** serialized
UTF-8 package file, formatted just like the request code. Do not reserialize the
file to compute this code. HPKE base mode authenticates ciphertext integrity. Comparing the code before
import verifies the package against the one approved on the sender's display.

## One-time import

Allow one importer at a time. After the package validates and decrypts, bind the
request to that package's full digest. Track each account save. A failed or
cancelled attempt can retry the same file before expiry and skip completed
records. Storage adapters need idempotent upserts because an interrupted save
may partially succeed. OAuth-required accounts count as saved once their
settings are stored for sign-in.

Once all records are saved, mark the request used and discard access to its
private key. Expiry and cancellation of the request also discard access. Never
start an account save after expiry. A save already in flight may finish.

The Node reference SDK holds its request key and retry progress in process
memory. It rejects repeats while the session is alive. Restarting discards the
key and requires a new request. If a host adds durable resume, it must keep its
key in protected storage and serialize consumption, progress, and key removal
without allowing a consumed request to be restored from backup. JavaScript
cannot guarantee that in-memory key material is immediately overwritten.

Copies of the file may remain on disk. A malicious client can keep the
original credentials or its decryption key. A cooperating recipient enforces
one-time use by discarding its private key.

## Try it with synthetic accounts

From the repository root:

```sh
npm run demo:transfer --workspace @mailport/sdk -- "$HOME/Downloads/MailPort-demo.mailportrequest"
```

Leave the receiver running. In MailPort Vault select sample accounts, click
**Export**, then **Open import file**. Compare the code with the one shown
in the demo and click **Codes match · Save** if it matches. Downloads is the
default folder in both dialogs. Paste the saved package path into the demo
terminal to import and confirm its code. The demo
reports per-account results and discards credentials. The SDK adapter is where
an actual client would save settings and use its credential store.

See [the SDK API](../packages/sdk/src/transfer.ts) and run
`npm run check:compatibility` to exercise a Rust-to-Node transfer, a selected
subset, retries, concurrent calls and replay.
