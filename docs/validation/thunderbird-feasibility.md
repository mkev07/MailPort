# Thunderbird integration feasibility

Local inspection on 2026-11-19: the installed Thunderbird reports version
138.0.1. Its bundled `chrome/messenger/content/messenger/schemas/accounts.json`
exposes account listing, lookup, default identity operations and account events,
but no account creation operation in the `accounts` namespace.

This is evidence about that installed version and namespace only; it does not
establish that all Thunderbird versions or other integration mechanisms lack a
way to create accounts. Before building an importer, identify and validate a
supported mechanism for creating IMAP and SMTP accounts, storing credentials
securely, obtaining user consent, and handling partial writes and rollback.
A privileged extension or application patch would have a larger security and
distribution surface and must be assessed separately. No Thunderbird account
or profile was modified, and no Thunderbird integration has been implemented.

The same installed build's bundled extension schema marks `experiment_apis`
as privileged. That is a possible area for investigation, not evidence that
such an extension is supported for general distribution or that it can safely
perform MailPort imports. The current reference SDK targets Node.js rather than
Thunderbird's extension runtime, so interoperability and key handling also need
an appropriate runtime implementation or a reviewed local bridge.

The installed build also contains an internal `CreateInBackend.sys.mjs` module
used by its account setup flow. Its implementation creates servers and an
account, can add passwords to the login manager, and saves account preferences.
This is an internal implementation observed in Thunderbird 138.0.1, not a
documented stable extension API. Its multi-step writes require failure and
rollback analysis before it could be used in a local synthetic prototype.
