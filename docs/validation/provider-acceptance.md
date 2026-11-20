# Live provider acceptance

The controlled mail tests cover delivery, synchronization, and independent
IMAP and SMTP password storage. Live provider acceptance requires dedicated
test mailboxes and receiving builds cleared for those credentials. Use a
fresh profile for each client and a separate test mailbox as the destination.
Record provider, client version, operating system, and the outcome of each
step. Keep passwords, tokens, addresses, and message content out of the report.

| Flow | Evidence to collect |
| --- | --- |
| Password authentication | Import two selected accounts with different IMAP and SMTP settings. Restart the client. From each imported account, send a uniquely identified fixture message and verify it arrives in the intended mailbox. Reply and verify the reply appears in the imported inbox. |
| App password | Repeat with a dedicated app password on a provider that supports it. After testing, revoke it and verify a new connection asks for updated credentials. |
| Google OAuth | Include a Google account alongside a password account. Verify MailPort saves the password account and lists Google under **Sign in separately**. Add Google through the receiving client's own account setup, cancel once, then complete sign-in and verify send and receive after restart. |
| Microsoft OAuth | Repeat the separate sign-in flow using the receiving client's supported Microsoft account setup. Record the authentication and delivery mechanism used by that client. |

The synthetic Thunderbird add-on and Mailspring development preview are
validated with fixture data. The local fixture cannot establish provider
consent, provider policy, or successful access to a live mailbox.
