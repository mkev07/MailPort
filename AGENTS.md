# MailPort project instructions

## Work tracking

Use `factorylog` for durable changes. Before editing, run
`factorylog start --title "<short title>" --summary "<what is starting>" --source <agent>`.
Preserve its task ID, report factual milestones with `factorylog report`, and
archive completed work with `factorylog archive`. Report blockers and leave blocked
tasks open. Do not log secrets, code, diffs, command output or guessed percentages.
Read-only answers and status checks do not need a log.

## Interface work

- Read DESIGN.md before design changes. The selected direction is Option A:
  a compact native vault with an account list, details pane and familiar toolbar.
- Use Vercel UI SDK where it improves keyboard navigation, selection, focus,
  dismissal and accessible interactive components. Read
  `.agents/skills/ui-sdk/SKILL.md` when working with UI SDK. Follow its references
  and the documentation shipped with the version actually installed.
- This is an interaction library, not a visual theme. Do not assume installing it
  fixes layout, typography, spacing or visual hierarchy.
- Add `@ui-sdk/core` and `@ui-sdk/react` to `apps/vault` when implementing an
  appropriate component. Keep runtime dependencies out of the email provisioning
  SDK and Rust vault core. Prefer native HTML controls when sufficient.
- Preserve privacy boundaries. Do not expose credentials, passphrases or privileged
  vault operations through agent tooling or WebMCP as a side effect of UI SDK use.
  Do not introduce remote scripts or widen the desktop CSP for UI components.
- The user requested Craft (https://github.com/diego3g/craft) for the current
  visual redesign. Use its applicable design workflow and approval gates, with
  DESIGN.md as the brief. User instructions take precedence over skill defaults.
- Preserve all vault behavior during visual changes. Type-check and build the
  frontend, run relevant checks, rebuild the native app, and open it for review.
  Distinguish local verification from Windows/Linux and release acceptance.

See apps/vault/AGENTS.md for desktop credential-handling requirements.
