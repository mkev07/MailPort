# Contributing to MailPort

MailPort is MIT licensed. Contributions should keep the specification readable,
use established cryptographic primitives, and preserve explicit account selection.

Use Node.js 22+ and run:

```sh
npm ci
npm run check
```

Add meaningful tests for changed security or compatibility behavior. Use only
synthetic credentials. Never attach a real vault, decrypted accounts or provider
tokens to an issue or pull request. Update documentation when changing account
fields, envelope encoding, cryptographic parameters, or import semantics.

Do not claim provider connectivity, OS keychain protection, independently built
client interoperability or security review on the basis of in-memory tests.
Discuss changes to the draft format before treating them as stable.
