# MailPort design brief

Status: draft for review. Option A is selected; proposed visual details below have
not yet been approved. The current implementation still reflects the rejected UI.

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
brand rules: the user rejected the current UI. No independent brand palette or
logo has been confirmed. System typography and a restrained accent are proposed
(assumed); no replacement colors are selected yet.

## References

- User-selected Option A: take the compact account list, details pane and familiar
  desktop toolbar. Keep account selection and export explicit.
- shell-zero: existing technical window/material foundation, not evidence that
  the user approved MailPort's present layout.
- Craft: design-process reference, not a visual theme.
- Vercel UI SDK: interaction/accessibility behavior reference, not a visual theme.

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
required. Proposed theme: neutral native surfaces, with the existing dark mode
as the first implementation (assumed). Platform-native visual conventions should
not prevent equivalent Windows/Linux operation.

## Decisions log

- 2026-11-19 — User rejected the initial MailPort UI and requested Craft to guide the redesign.
- 2026-11-19 — User selected Option A: native vault, compact account list, details pane and familiar toolbar.
- 2026-11-19 — User requested Vercel UI SDK as needed throughout the project. Keep this separate from the provisioning SDK and visual design decisions.

## Open questions

- Confirm the proposed mood, avoid list and visual details before implementation.
- Light, dark or both? Dark-first is only a proposal; it is not a confirmed preference.
- Which product references best match the intended look, and what should be taken or avoided?
- No approved brand colors, custom typeface or final icon/logo yet.
- Account details pane should show saved server settings by default; whether editing is inline or a separate form is still a proposal.
