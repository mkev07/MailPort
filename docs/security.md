# Security model and review gates

## Assets and trust

Passwords, app passwords, addresses, usernames and server configuration are
private. A strong passphrase protects a stolen encrypted file against offline
access, subject to its entropy and the KDF cost. No server holds a recovery key
because this prototype has no server or recovery service.

The operating system, trusted vault process and its dependencies are trusted.
The selected receiving client necessarily gains selected credentials. An attacker
controlling the unlocked process, OS, debugger or approved client can read them.
This SDK is not a sandbox, phishing defense, OS keychain or trusted display.

## Threats handled locally

Authenticated encryption detects modified encrypted content. Version/suite checks
prevent silent downgrade. Fixed KDF parameters and input size limits constrain
individual untrusted files. Strict payload validation rejects unsupported fields
and insecure transport settings. SDK result errors omit adapter exception text
because those messages can contain credentials.

Host applications must still rate-limit unlock attempts and concurrent KDF calls,
limit input before reading entire files, avoid logging inputs, and secure file
permissions. Read/modify/write operations need atomic replacement and backup
policies. This library returns encrypted bytes and does not implement storage.

## Passwordless packages

[File transfers](transfer.md) bind selected accounts to a short-lived request
key. The user compares request and package fingerprints through trusted
displays. A cooperating receiver drops its key after successful import and
rejects replays. The current receiver drops its key on exit and keeps retry
progress for the lifetime of its process. There is no independent identity
attestation. A recipient that retains credentials can continue to use them.

## Remaining threats and host obligations

- Offline guessing remains possible; use a strong, unique passphrase.
- Lost passphrase means lost access unless the user has an independent recovery copy.
- Encryption cannot detect replay of an older valid vault. Rollback protection needs trusted state outside the file.
- JavaScript strings and parsed accounts cannot be reliably wiped. Key/plaintext buffers are cleared on supported paths, but copies and runtime memory may remain.
- Summaries still reveal private addresses and display names; exclude them from telemetry.
- Approval in the reference API is caller asserted. Build consent UI in the vault's trusted process, then authenticate the receiving application before disclosing anything.
- Reimport behavior and partial persistence depend on the adapter. Use stable account IDs and secure credential-store updates.
- TLS configuration must be enforced by the client: verify certificates and hostnames, fail closed on STARTTLS failure, and never downgrade to plaintext.
- Hosts may target local/private networks. Future network validation and discovery features need an explicit SSRF and local network policy.
- Revoking vault permission cannot retract an exported credential. Revoke an app password or change it at the provider.

No network connections are made by the current SDK. The tests do not establish
provider compatibility, successful mailbox authentication, or safe OS storage.

## Release gates

Before recommending real credentials: independently review the cryptographic
format and implementation; verify cross-language vectors; implement secure local
storage and lock lifecycle; review the file transfer and any future direct transfer protocol;
exercise malicious recipient, replay, wrong-recipient and partial-failure cases;
and complete two real client integrations. Browser and native support each need
platform-specific review. Automated tests are evidence for the tested behaviors,
not a security audit.

## Desktop prototype

The Tauri backend owns vault file paths, unlocked account state and native export
dialogs. The frontend receives summaries and redacted account edit data, and sends
newly entered secrets over local IPC. No filesystem plugin is exposed to the UI;
there is no asset protocol exposing the application data directory. The production
CSP allows local bundled scripts and local Tauri IPC; account avatar images may
be loaded from Gravatar using an email-address hash. Window
capabilities apply to the main window only. Development source-picking tooling is
not included. The Rust master passphrase and account types clear owned buffers on
drop where supported; the frontend and crypto libraries may still hold copies.

This constrains accidental disclosure but is not a complete compromise boundary:
malicious code executing in the trusted webview can invoke its allowed backend
commands. Packaging integrity, dependency review, injection resistance and explicit
approval remain essential. The glass shell inherits macOS private API code and
ad-hoc signing defaults; production distribution needs separate decisions and
review. Never use the development build for sensitive credentials.
