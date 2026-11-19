# MailPort design brief

Option A is implemented in the desktop preview. Visual acceptance is pending.

## Product

MailPort is an MIT-licensed portable email account vault and provisioning SDK.
The desktop vault stores account settings and credentials locally, and exports
explicitly selected accounts in an encrypted package. The main screen's job is
to find, inspect, edit and select accounts for transfer. macOS, Windows and Linux
are the desktop targets. SDK consumers need not use the vault's UI stack.

## Audience and voice

People with many email accounts, including people unfamiliar with IMAP/SMTP.
Email-client developers integrate the separate SDK. Proposed voice: brief, plain,
precise (assumed). Explain OAuth and credential disclosure at the relevant action.
Do not imply that saved settings prove a successful mailbox connection.

## Mood

Selected direction: Option A, a compact native vault with an account list,
clear details pane and familiar toolbar.

Proposed mood: calm, clear, dependable (assumed). Proposed avoid list: oversized
marketing headings, slogans inside the account workspace, decorative unused
panels, tiny secondary controls and dashboard-like cards (inferred from review;
not yet individually confirmed by the user).

## Brand

Name: MailPort. Product: MailPort Vault. Tagline: “Set up once. Bring your accounts
with you.” The tagline need not occupy space in the everyday account workspace.
MIT licensing and the product names are confirmed.

Design system source: `apps/vault/src/styles/index.css` and
`apps/vault/src/styles/vault.css`, with existing controls in
`apps/vault/src/App.tsx`. These are implementation starting points, not approved
brand rules: the user rejected the current UI. Use the supplied MailPort logo and App Icon Composer artwork. The interface palette remains open. Typeface: Allo by Josh Puckett for interface text. Use Paper Mono for port values, passwords and secret references.
Bundle it locally under its SIL Open Font License, with automatic optical sizing
and weights supplied by the variable font. A restrained accent is proposed
(assumed); no replacement colors are selected yet.

Icon family: Hugeicons Standard Duotone, selected by the user. Pro access is
provided privately. Do not commit credentials or Pro icon source files to the
MIT repository. The public-source/release-build licensing strategy is pending.

## References

- User-selected Option A: take the compact account list, details pane and familiar
  desktop toolbar. Keep account selection and export explicit.
- shell-zero: existing technical window/material foundation, not evidence that
  the user approved MailPort's present layout.
- Craft: design-process reference, not a visual theme.
- Vercel UI SDK: interaction and accessibility behavior reference.
- Monocode: neutral dark surfaces, inset panes, subtle borders and restrained selection.
- Lotion: native split-view hierarchy and AppKit Liquid Glass surfaces. MailPort uses
  AppKit glass views beneath action buttons and round profile avatars on
  supported macOS versions. The account and sidebar rows use flat navigation
  styling. Controls retain their web styling when native glass is unavailable
  or Reduce Transparency is enabled.
- Unslop UI: remove decorative labels, repeated explanations and slogans. Keep
  actionable states, field constraints and export disclosures.

Specific product references and what to take/avoid from them remain open.

## Constraints

Tauri 2, React and Rust. Unlocked credentials and file operations stay in Rust;
list views receive summaries and saved passwords remain redacted in edit data.
No remote UI scripts, credentials in logs or browser storage, or extra permissions
introduced by the redesign. OAuth stays visibly pending sign-in.

Preserve create/unlock/lock, editing, synthetic samples, account selection and
separate-password encrypted export. Cover empty, loading, locked, populated,
selected, validation-error, operation-error and export-cancelled states.

Keyboard operation, visible focus, named controls and reduced-motion support are
required. Theme: dark neutral surfaces, using the Monocode reference. Platform-native visual conventions should
not prevent equivalent Windows/Linux operation.

## Decisions log

- 2026-11-19 — User rejected the initial MailPort UI and requested Craft to guide the redesign.
- 2026-11-19 — User selected Option A: native vault, compact account list, details pane and familiar toolbar.
- 2026-11-19 — User requested Vercel UI SDK as needed throughout the project. Keep this separate from the provisioning SDK and visual design decisions.

- 2026-11-19 — User selected Allo for typography and Hugeicons Standard Duotone for icons. Keep font assets local and Pro credentials private.

- 2026-11-19 — Adopted the Monocode dark glass reference and Lotion’s AppKit glass approach. Applied Unslop UI to the vault copy and decorative elements.

## Open questions

- Confirm the proposed mood, avoid list and visual details before implementation.
- A light theme remains undecided.
- Which product references best match the intended look, and what should be taken or avoided?
- No approved interface palette yet. The supplied MailPort logo and application icons are confirmed. Allo and the requested Hugeicons family are confirmed.
- Resolve the Pro icon licensing strategy for public source builds.
- The details pane shows server hosts and authentication status. Add and edit forms open in the details pane. Export sits by the account selection count and opens a confirmation dialog. Lock vault sits in the sidebar footer.
