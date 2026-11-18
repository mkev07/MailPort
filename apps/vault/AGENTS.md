# MailPort Vault

This is the MailPort application adapted from shell-zero, not the upstream template.
Keep the source attribution in THIRD_PARTY_NOTICES.md. Never push MailPort changes
to mkev07/shell-zero. Use the MailPort repository remote.

Keep encryption, unlocked credential state and file access in Rust. Do not store
credentials in localStorage or include them in logs, URLs or clipboard contents.
Use synthetic accounts for development and review. Verify changes with the root
npm checks, Rust tests, format compatibility check and a native application build.

Read the root AGENTS.md and DESIGN.md before UI changes. Use the project-scoped
`.agents/skills/ui-sdk/SKILL.md` when UI SDK behaviors apply.
