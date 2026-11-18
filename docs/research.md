# Planning research

These references and assessments were supplied during initial project planning.
They have not been independently reverified in this repository. The investigation
was targeted and does not prove the absence of an equivalent product.

- [GNOME Online Accounts](https://github.com/GNOME/gnome-online-accounts): central account management for supported GNOME applications; a close architectural relative.
- [KeePassXC Secret Service](https://github.com/keepassxreboot/keepassxc/blob/develop/docs/topics/SecretService.adoc): credential access from an encrypted vault; does not define email account provisioning.
- [Thunderbird autoconfiguration](https://wiki.mozilla.org/Thunderbird:Autoconfiguration): potential server settings discovery infrastructure.
- [K-9 Mail export/import](https://docs.k9mail.app/en/6.400/settings/export): account configuration portability within its ecosystem; this older linked documentation excludes passwords.
- [Apple managed mail profiles](https://github.com/apple/device-management/blob/release/mdm/profiles/com.apple.mail.managed.yaml): Apple account provisioning; consult current encryption requirements before including passwords.
- [EmailEngine](https://github.com/postalsys/emailengine): an account API service, rather than direct provisioning into independent clients; research identified it as source available.
- [OpenCore Email SDK](https://github.com/opencoredev/email-sdk): an MIT transactional sending SDK. Its adapter pattern is relevant, but it is not a vault or bulk account provisioning SDK and is not a MailPort dependency.

MailPort's focus is a user-owned vault, an open account specification, explicit
selection and interoperable provisioning into participating email clients.

`mailport.mx` is a proposed domain. Availability was reported during planning;
MailPort has not registered it or independently confirmed its current availability.
