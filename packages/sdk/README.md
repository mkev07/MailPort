# MailPort SDK

MailPort's Node.js reference SDK helps a receiving email client import selected
account settings from MailPort Vault. This is a developer preview for synthetic
data; the package is marked private and is not configured for npm publication. It requires Node.js
22 or later and is distributed as an ES module.

The SDK handles request creation, transfer-code calculation, package
decryption, validation, and per-account results. The receiving application is
responsible for showing the verification codes, obtaining the user's approval,
storing credentials securely, configuring accounts, and handling provider
sign-in and partial writes. An imported password can be retained by the client.

For local development, clone the [MailPort repository](https://github.com/mkev07/MailPort),
run `npm ci`, and run `npm run check --workspace @mailport/sdk`. The
[synthetic receiver example](https://github.com/mkev07/MailPort/blob/main/packages/sdk/examples/receive-transfer.ts)
demonstrates the file flow without persisting accounts. The
[transfer specification](https://github.com/mkev07/MailPort/blob/main/docs/transfer.md)
describes the wire format and retry behavior; the
[security model](https://github.com/mkev07/MailPort/blob/main/docs/security.md)
describes host obligations and release gates.

The package has not received independent security review. The SDK does not
prove that a provider accepted credentials or that a receiving client stored
them durably. OAuth accounts must complete the receiving client's own sign-in.
