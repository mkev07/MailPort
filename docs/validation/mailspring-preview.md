# Mailspring integration preview

This is a local proof of concept, not an upstream Mailspring integration or a
release for real credentials. The prototype was built against Mailspring commit
`0635d327398c8d97255660ae7b0011bf1e3fe4df` in a separate checkout and run with
an isolated configuration directory. The preview bypasses Mailspring's normal
first-run sign-in only when explicitly started in preview mode.

## Local evidence

- Mailspring created a request and displayed its verification code. The Rust
  MailPort core generated a synthetic two-account package for that request; the
  request and transfer codes matched those displayed by the receiver.
- The Mailspring preview reported two accounts saved. Its isolated configuration
  contained two synthetic account records with no password fields, and an
  encrypted credential entry. Mail server authentication was not attempted as
  an acceptance test.
- A separate UI test created a request in Mailspring, selected two sample
  accounts in Vault, compared both codes, approved the macOS authentication
  prompt, and imported the resulting Vault export in Mailspring. The isolated
  profile contained exactly the two selected accounts, their expected TLS modes,
  no plaintext password fields in account records, and an encrypted credential
  entry. A separate Electron process using Mailspring's app identity decrypted
  that profile and matched both synthetic IMAP and SMTP passwords without
  displaying them. A mailbox connection was not tested.
- Cancelling either app's file dialog preserved the request. The Vault rejected
  an expired request. Automated transfer checks also cover cancellation before
  any account save followed by retry, partial failure, replay and expiry.
- Adapter tests cover independent IMAP and SMTP credentials, TLS mapping,
  duplicate rejection, unsupported OAuth and storage errors. They also verify
  that a thrown save is not attempted again by the same adapter. Mailspring's
  TypeScript check and the MailPort transfer compatibility checks passed.
- Testing exposed an Electron renderer timer incompatibility in the SDK; the SDK
  uses Node timers for request expiry and has a regression test for browser-style
  global timers.

## Limitations

The preview imports password accounts only. OAuth accounts are rejected
and must not be reported as imported. Existing Mailspring accounts are not
overwritten. A profile-wide, non-secret marker blocks later imports after an
ambiguous save; it does not repair partial writes. Cross-platform testing, dependency packaging,
and security review remain open. The preview is not a production-ready plugin.

Mailspring's configuration persistence manager can return after an unsuccessful
disk write without propagating the failure to `AccountStore.addAccount`. The
adapter therefore cannot establish durable storage merely from a resolved save.
The preview now reads the profile after a save and checks the account's server
settings and both decrypted credentials before reporting the account verified.
Unit tests cover matching, incorrect credentials, insecure settings and read
failure. A synthetic Rust-to-Mailspring UI transfer passed with the snapshot
check. Injected persistent write failures beginning at the credential and account
record steps each reported zero verified accounts and blocked a new UI import
after restart. At the credential step neither account nor credentials were on
disk; at the account step the encrypted synthetic credentials remained without
an account record. These are controlled failures, not exhaustive crash testing.
The adapter also checks for existing credential keys before saving. Unit tests
cover an orphaned, differently cased credential and an unreadable store. A UI
test removed the marker in a controlled synthetic profile and confirmed that
the orphaned credentials remained unchanged and the import was refused. This
check does not prevent a concurrent non-MailPort operation from racing the save.
The successful synthetic test above was independently checked on disk; that
evidence does not prove future saves will persist. A production integration must
handle interruptions and partial writes across restarts before claiming a
crash-safe durable import; an immediate snapshot check alone is insufficient.

The pending marker is flushed before the save and removed after verification,
but Mailspring's own write durability, power loss, and directory syncing across
platforms have not been verified. The preview deliberately blocks imports if
the marker cannot be created or synchronized. No automatic marker recovery or
cleanup is provided.
If synchronizing marker removal fails, the preview attempts to restore the
marker and reports failure. A unit test covers successful restoration after an
injected directory-sync error; a second failure while restoring remains
ambiguous and is not claimed to be crash-safe.

This was reproduced in a running Electron process with a new synthetic profile:
the test redirected the configuration file to an invalid path and dismissed its
save-error dialog, then confirmed the setter returned and the original file was
unchanged. It tests the configuration layer, not a complete account import or
every interruption point. Run `node integrations/mailspring/check-persistence-failure.cjs /path/to/Mailspring`
with the prepared checkout's dependencies installed. The test creates and removes
its own temporary profile; close other Mailspring instances before running it.
