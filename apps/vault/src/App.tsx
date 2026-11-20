import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast, Toaster } from "sonner";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LoadingLabel } from "./components/LoadingLabel";
import { DeleteDropDots } from "./components/DeleteDropDots";
import { EmailAvatar } from "./components/EmailAvatar";
import { CheckCircle } from "./shared/ui/icons";
import { tintChannels } from "./features/settings/model/tint";
import { useAccountDrag } from "./useAccountDrag";
import { useNativeButtonGlass } from "./useNativeButtonGlass";
import {
  newProfile,
  ProfileAvatar,
  ProfileForm,
  type Profile,
} from "./features/profiles/ProfileAvatar";
import {
  activateWindowAppearance,
  applyThemePreference,
  isLightScheme,
  saveThemePreference,
  SCHEME_CHANGE_EVENT,
  saveBodyGlass,
  saveInsetLayout,
} from "./features/settings/model/appearance";

type Auth =
  | { type: "password"; password: string }
  | { type: "oauth"; providerId: string };
type Server = {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
  auth: Auth;
};
type Connection = {
  host: string;
  port: number;
  security: "tls" | "starttls";
  username: string;
};
type Account = {
  id: string;
  email: string;
  displayName: string;
  incoming: Server;
  outgoing: Server;
};
type Summary = {
  id: string;
  email: string;
  displayName: string;
  incoming: Connection;
  outgoing: Connection;
  requiresSignIn: boolean;
  profileId: string | null;
};
type Status = {
  exists: boolean;
  unlocked: boolean;
  accounts: Summary[];
  profiles: Profile[];
  touchIdAvailable: boolean;
  touchIdEnabled: boolean;
  onePasswordAvailable: boolean;
  onePasswordEnabled: boolean;
};
type AutoLockState = { remainingSeconds: number; paused: boolean };
type QuickMethod = "touchId" | "onePassword";
type ExportRecipient = {
  requestFile: string;
  clientName: string;
  verificationCode: string;
};
type SavedTransfer = {
  code: string;
  fileName: string;
  folderName: string | null;
};
type TransferPane =
  | { stage: "request" }
  | { stage: "review"; recipient: ExportRecipient }
  | ({ stage: "saved" } & SavedTransfer);
const securityLabels: Record<Connection["security"], string> = {
  tls: "TLS",
  starttls: "STARTTLS",
};
function securityLabel(security: Connection["security"]) {
  return securityLabels[security] ?? security.toUpperCase();
}
function Icon({
  name,
  size = 20,
}: {
  name:
    | "mail"
    | "lock"
    | "plus"
    | "arrow"
    | "shield"
    | "gear"
    | "close"
    | "export"
    | "folder"
    | "edit"
    | "sidebar"
    | "grab"
    | "trash"
    | "sun"
    | "moon"
    | "check";
  size?: number;
}) {
  const paths = {
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="4" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    lock: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="3" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    gear: (
      <>
        <path d="M10 3h4l.6 2.8 1.4.8 2.7-.9 2 3.5-2.1 1.9v1.8l2.1 1.9-2 3.5-2.7-.9-1.4.8L14 21h-4l-.6-2.8-1.4-.8-2.7.9-2-3.5 2.1-1.9v-1.8L3.3 9.2l2-3.5 2.7.9 1.4-.8z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-5" />
      </>
    ),
    grab: (
      <path
        d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"
        strokeWidth="3"
      />
    ),
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
    check: <path d="m5 12 4 4L19 6" />,
    trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    sidebar: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="M15 5v14" />
      </>
    ),
    export: (
      <>
        <path d="M12 15V3m-4 4 4-4 4 4M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5" />
      </>
    ),
    folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
    edit: (
      <>
        <path d="m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14l-1 6Z" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
function AccountProfilePicker({
  profiles,
  profileId,
  email,
  disabled,
  onChoose,
}: {
  profiles: Profile[];
  profileId: string | null;
  email: string;
  disabled: boolean;
  onChoose: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !picker.current?.contains(event.target)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  const current = profiles.find((profile) => profile.id === profileId);
  const avatar = (profile?: Profile) =>
    profile ? (
      <ProfileAvatar profile={profile} />
    ) : (
      <span className="profile-avatar" aria-hidden="true">
        <Icon name="mail" size={16} />
      </span>
    );
  const choose = (id: string | null) => {
    setOpen(false);
    trigger.current?.focus();
    if (id !== profileId) onChoose(id);
  };
  return (
    <div
      className="account-profile-picker"
      ref={picker}
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-button account-profile-trigger"
        aria-label={`Assign profile, current: ${current?.name ?? "Ungrouped"}`}
        title={`Assign profile · ${current?.name ?? "Ungrouped"}`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        <EmailAvatar
          email={email}
          lookup
          className="account-card-email-avatar"
        />
        {current && (
          <span
            className="account-profile-dot"
            style={{ background: current.color }}
            aria-hidden="true"
          />
        )}
      </button>
      {open && (
        <div className="account-profile-popover">
          <div
            className="account-profile-options"
            role="group"
            aria-label="Assign profile"
          >
            <button
              type="button"
              aria-pressed={!current}
              onClick={() => choose(null)}
            >
              {avatar()} <span>Ungrouped</span>
            </button>
            {profiles.map((profile) => (
              <button
                key={profile.id}
                type="button"
                aria-pressed={profile.id === profileId}
                onClick={() => choose(profile.id)}
              >
                {avatar(profile)} <span>{profile.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
  className,
}: {
  title: string;
  className?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className ? `vault-dialog ${className}` : "vault-dialog"}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
function DeleteAccountsButton({
  count,
  dragging,
  dropActive,
  disabled,
  onClick,
}: {
  count: number;
  dragging: boolean;
  dropActive: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const destructive = dropActive || (hovered && !disabled);
  return (
    <button
      id="delete-accounts"
      type="button"
      className={destructive ? "secondary danger-button" : "secondary"}
      disabled={disabled}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") setHovered(true);
      }}
      onPointerLeave={() => setHovered(false)}
      onPointerCancel={() => setHovered(false)}
      onClick={onClick}
    >
      <Icon name="trash" size={16} />
      {dragging ? (
        dropActive ? "Release to review" : "Drop to delete"
      ) : (
        <>
          Delete <span className="selection-count">{count}</span>
        </>
      )}
    </button>
  );
}
type PassphraseField = "password" | "confirm";
type PassphraseError = { field: PassphraseField; message: string };
function PasswordFields({
  creating,
  issue,
  onInput,
}: {
  creating: boolean;
  issue: PassphraseError | undefined;
  onInput: (field: PassphraseField) => void;
}) {
  const fields: readonly PassphraseField[] = creating ? ["password", "confirm"] : ["password"];
  return fields.map((field) => {
    const message = issue?.field === field ? issue.message : undefined;
    return (
      <div className="unlock-field" key={field}>
        <label htmlFor={`unlock-${field}`}>
          {field === "confirm"
            ? "Confirm master passphrase"
            : creating ? "Master passphrase" : "Enter Master Passphrase"}
        </label>
        <input
          id={`unlock-${field}`}
          name={field}
          autoFocus={field === "password"}
          type="password"
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `unlock-${field}-error` : undefined}
          onInput={() => onInput(field)}
          autoComplete={creating ? "new-password" : "current-password"}
          required
          minLength={12}
        />
        {message && (
          <p id={`unlock-${field}-error`} className="passphrase-error" role="alert">
            {message}
          </p>
        )}
      </div>
    );
  });
}
const newAccount = (): Account => ({
  id: "",
  email: "",
  displayName: "",
  incoming: {
    host: "",
    port: 993,
    security: "tls",
    username: "",
    auth: { type: "password", password: "" },
  },
  outgoing: {
    host: "",
    port: 587,
    security: "starttls",
    username: "",
    auth: { type: "password", password: "" },
  },
});
type DiscoveredEndpoint = Pick<Server, "host" | "port" | "security">;
type Discovery = {
  incoming: DiscoveredEndpoint | null;
  outgoing: DiscoveredEndpoint | null;
  provider: string | null;
};

function PortFields({
  server,
  outgoing,
  onChange,
}: {
  server: Server;
  outgoing: boolean;
  onChange: (server: Server) => void;
}) {
  const ports = outgoing ? [587, 465, 2525, 25] : [993, 143];
  const [custom, setCustom] = useState(false);
  const mode =
    custom || !ports.includes(server.port) ? "custom" : String(server.port);
  return (
    <>
      <Field label="Port">
        <select
          className="numeric-value"
          value={mode}
          onChange={(event) => {
            const value = event.target.value;
            setCustom(value === "custom");
            if (value === "custom") return;
            const port = Number(value);
            onChange({
              ...server,
              port,
              security: port === 993 || port === 465 ? "tls" : "starttls",
            });
          }}
        >
          {ports.map((port) => (
            <option key={port} value={port}>
              {port}
            </option>
          ))}
          <option value="custom">Custom port</option>
        </select>
      </Field>
      {mode === "custom" && (
        <Field label="Custom port">
          <input
            type="number"
            min={1}
            max={65535}
            required
            value={server.port || ""}
            onChange={(event) =>
              onChange({ ...server, port: Number(event.target.value) })
            }
          />
        </Field>
      )}
      <Field label="Security">
        <select
          value={server.security}
          onChange={(event) =>
            onChange({
              ...server,
              security: event.target.value as Server["security"],
            })
          }
        >
          <option value="tls">TLS</option>
          <option value="starttls">STARTTLS</option>
        </select>
      </Field>
    </>
  );
}

function LoginFields({
  auth,
  onChange,
  editing = false,
}: {
  auth: Auth;
  onChange: (auth: Auth) => void;
  editing?: boolean;
}) {
  return (
    <>
      <Field label="Authentication">
        <select
          value={auth.type}
          onChange={(event) =>
            onChange(
              event.target.value === "oauth"
                ? { type: "oauth", providerId: "" }
                : { type: "password", password: "" },
            )
          }
        >
          <option value="password">Password or app password</option>
          <option value="oauth">OAuth</option>
        </select>
      </Field>
      {auth.type === "password" ? (
        <Field
          label="Password or app password"
          hint={editing ? "Leave blank to keep the saved password." : undefined}
        >
          <input
            type="password"
            autoComplete="new-password"
            value={auth.password}
            required={!editing}
            onChange={(event) =>
              onChange({ type: "password", password: event.target.value })
            }
          />
        </Field>
      ) : (
        <Field label="OAuth provider" hint="Sign in through your email client.">
          <input
            value={auth.providerId}
            required
            maxLength={128}
            placeholder="google or microsoft"
            onChange={(event) =>
              onChange({ type: "oauth", providerId: event.target.value })
            }
          />
        </Field>
      )}
    </>
  );
}

function ServerFields({
  outgoing = false,
  server,
  editing,
  separate,
  sameHost,
  onChange,
}: {
  outgoing?: boolean;
  server: Server;
  editing: boolean;
  separate: boolean;
  sameHost?: boolean;
  onChange: (server: Server) => void;
}) {
  return (
    <fieldset className="server-fields">
      <legend>{outgoing ? "Outgoing (SMTP)" : "Incoming (IMAP)"}</legend>
      <div className="form-grid server-grid">
        {!sameHost && (
          <Field label="Server hostname">
            <input
              value={server.host}
              onChange={(event) =>
                onChange({ ...server, host: event.target.value })
              }
              required
              placeholder={outgoing ? "smtp.example.com" : "imap.example.com"}
            />
          </Field>
        )}
        <PortFields server={server} outgoing={outgoing} onChange={onChange} />
        {separate && (
          <>
            <Field label="Username">
              <input
                value={server.username}
                onChange={(event) =>
                  onChange({ ...server, username: event.target.value })
                }
                required
                autoComplete="off"
              />
            </Field>
            <LoginFields
              auth={server.auth}
              editing={editing}
              onChange={(auth) => onChange({ ...server, auth })}
            />
          </>
        )}
      </div>
    </fieldset>
  );
}

function emailDomain(email: string): string {
  return /^[^\s@]+@(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(
    email.trim(),
  )
    ? email.trim().split("@")[1].toLowerCase()
    : "";
}

function editorActionPosition(x: number, y: number, source: DOMRect) {
  const below = y + 12;
  return {
    left: Math.max(12, Math.min(x - source.width / 2, innerWidth - source.width - 12)),
    top: below + source.height + 12 <= innerHeight
      ? below
      : Math.max(12, y - source.height - 12),
  };
}

function AccountForm({
  initial,
  busy,
  error,
  onSave,
  onCancel,
}: {
  initial: Account;
  busy: boolean;
  error: string;
  onSave: (account: Account) => void;
  onCancel: () => void;
}) {
  const [outsideAction, setOutsideAction] = useState<{
    left: number;
    top: number;
    follow?: { left: number; top: number };
    source: DOMRect;
    cancelWidth: number;
    saveWidth: number;
    gap: number;
  }>();
  const saveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const dismissOutsideAction = () => {
    setOutsideAction(undefined);
    previousFocus.current?.focus();
  };
  const [draft, setDraft] = useState(initial);
  const [separate, setSeparate] = useState(!!initial.id);
  const [sameHost, setSameHost] = useState(!initial.id);
  const manualSameHost = useRef(false);
  const [advanced, setAdvanced] = useState(!!initial.id);
  const [username, setUsername] = useState("");
  const [auth, setAuth] = useState<Auth>({ type: "password", password: "" });
  const [lookup, setLookup] = useState<
    "idle" | "loading" | "found" | "partial" | "missing" | "failed"
  >("idle");
  const [retry, setRetry] = useState(0);
  const applied = useRef<Discovery | null>(null);
  const manualPorts = useRef({ incoming: false, outgoing: false });
  const manualAuth = useRef(false);
  const domain = emailDomain(draft.email);
  const latestDomain = useRef(domain);

  const changeServerSettings = (
    key: "incoming" | "outgoing",
    server: Server,
  ) => {
    if (
      server.port !== draft[key].port ||
      server.security !== draft[key].security
    ) {
      manualPorts.current[key] = true;
    }
    if (server.auth !== draft[key].auth) manualAuth.current = true;
    setDraft({ ...draft, [key]: server });
  };

  useEffect(() => {
    if (initial.id || !domain) return;
    let current = true;
    const timer = window.setTimeout(() => {
      setLookup("loading");
      void invoke<Discovery>("discover_mail_servers", { domain })
        .then((result) => {
          if (!current || latestDomain.current !== domain) return;
          applied.current = result;
          if (!manualSameHost.current && result.outgoing) {
            setSameHost(result.incoming?.host === result.outgoing.host);
          }
          const keepPorts = { ...manualPorts.current };
          const fill = (
            key: "incoming" | "outgoing",
            server: Server,
          ): Server => {
            const suggestion = result[key];
            if (!suggestion || server.host) return server;
            return keepPorts[key]
              ? { ...server, host: suggestion.host }
              : { ...server, ...suggestion };
          };
          setDraft((value) => ({
            ...value,
            incoming: fill("incoming", value.incoming),
            outgoing: fill("outgoing", value.outgoing),
          }));
          if (result.provider && !manualAuth.current) {
            const providerId = result.provider;
            const applyProvider = (value: Auth): Auth =>
              value.type === "password" && !value.password
                ? { type: "oauth", providerId }
                : value;
            setAuth(applyProvider);
            setDraft((value) => ({
              ...value,
              incoming: {
                ...value.incoming,
                auth: applyProvider(value.incoming.auth),
              },
              outgoing: {
                ...value.outgoing,
                auth: applyProvider(value.outgoing.auth),
              },
            }));
          }
          setLookup(
            result.incoming && result.outgoing
              ? "found"
              : result.incoming || result.outgoing
                ? "partial"
                : "missing",
          );
          if (result.incoming && result.outgoing) {
            toast.success("Mail server settings found.");
          }
          if (!result.incoming || !result.outgoing) setAdvanced(true);
        })
        .catch(() => {
          if (current && latestDomain.current === domain) {
            setLookup("failed");
            setAdvanced(true);
          }
        });
    }, 500);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [domain, initial.id, retry]);

  const changeEmail = (email: string) => {
    latestDomain.current = emailDomain(email);
    const changedDomain = latestDomain.current !== domain;
    const prior = changedDomain ? applied.current : null;
    const defaultAuth = (value: Auth): Auth =>
      !manualAuth.current &&
      prior?.provider &&
      value.type === "oauth" &&
      value.providerId === prior.provider
        ? { type: "password", password: "" }
        : value;
    const changeServer = (key: "incoming" | "outgoing"): Server => {
      const server = draft[key];
      const suggestion = prior?.[key];
      const resetHost = suggestion && server.host === suggestion.host;
      const defaults = newAccount()[key];
      return {
        ...server,
        ...(resetHost ? { host: "" } : {}),
        ...(resetHost && !manualPorts.current[key]
          ? { port: defaults.port, security: defaults.security }
          : {}),
        username:
          !server.username || server.username === draft.email
            ? email
            : server.username,
        auth: defaultAuth(server.auth),
      };
    };
    if (changedDomain) {
      setLookup("idle");
      if (!manualSameHost.current) setSameHost(true);
      applied.current = null;
      setAuth(defaultAuth);
    }
    setDraft({
      ...draft,
      email,
      incoming: changeServer("incoming"),
      outgoing: changeServer("outgoing"),
    });
  };

  const outgoingHost = sameHost ? draft.incoming.host : draft.outgoing.host;
  const hasServers = Boolean(draft.incoming.host && outgoingHost);
  const lookupMessage = {
    idle: "",
    loading: "Looking up mail servers…",
    found: "",
    partial: "Found one mail server. Enter the missing settings below.",
    missing:
      "Couldn’t find mail settings automatically. Enter the settings from your provider.",
    failed:
      "Couldn’t look up mail servers. Try again or enter the settings below.",
  }[lookup];
  const accountToSave = (): Account => {
    const email = draft.email.trim();
    const login = separate
      ? null
      : { username: username.trim() || email, auth };
    return {
      ...draft,
      email,
      incoming: {
        ...draft.incoming,
        ...login,
        host: draft.incoming.host.trim(),
      },
      outgoing: { ...draft.outgoing, ...login, host: outgoingHost.trim() },
    };
  };
  const pending = accountToSave();
  const serverChanged = (original: Server, updated: Server) =>
    original.host !== updated.host ||
    original.port !== updated.port ||
    original.security !== updated.security ||
    original.username !== updated.username ||
    (updated.auth.type === "oauth"
      ? original.auth.type !== "oauth" ||
        original.auth.providerId !== updated.auth.providerId
      : original.auth.type !== "password" ||
        original.auth.password !== updated.auth.password);
  const dirty =
    initial.email !== pending.email ||
    initial.displayName !== pending.displayName ||
    serverChanged(initial.incoming, pending.incoming) ||
    serverChanged(initial.outgoing, pending.outgoing);

  useEffect(() => {
    if (busy || outsideAction) return;
    const showAction = (event: MouseEvent) => {
      if (
        event.button !== 0 ||
        !(event.target instanceof Element) ||
        !event.target.closest(".vault-main") ||
        event.target.closest(".inline-editor, .profile-theme-switch")
      ) return;

      const cancel = cancelButton.current?.getBoundingClientRect();
      const save = dirty ? saveButton.current?.getBoundingClientRect() : undefined;
      if (!cancel || (dirty && !save)) return;
      const left = save ? Math.min(cancel.left, save.left) : cancel.left;
      const top = save ? Math.min(cancel.top, save.top) : cancel.top;
      const width = save ? Math.max(cancel.right, save.right) - left : cancel.width;
      const height = save ? Math.max(cancel.bottom, save.bottom) - top : cancel.height;
      const source = new DOMRect(left, top, width, height);
      event.preventDefault();
      event.stopPropagation();
      previousFocus.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setOutsideAction({
        ...editorActionPosition(event.clientX, event.clientY, source),
        source,
        cancelWidth: cancel.width,
        saveWidth: save?.width ?? 0,
        gap: Math.max(0, width - cancel.width - (save?.width ?? 0)),
      });
    };
    document.addEventListener("click", showAction, true);
    return () => document.removeEventListener("click", showAction, true);
  }, [busy, dirty, outsideAction]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!hasServers) {
      setAdvanced(true);
      return;
    }
    onSave(pending);
  };

  return (
    <form className="account-editor-form" onSubmit={submit}>
      <div className="account-editor-fields">
        <div className="detail-heading">
          <h2 id="editor-heading" tabIndex={-1}>
            {initial.id ? "Edit account" : "Add account"}
          </h2>
        </div>
        <fieldset disabled={busy}>
          <div className="detail-section editor-identity">
            <EmailAvatar
              key={draft.email}
              email={draft.email}
              lookup={Boolean(domain)}
            />
            <div className="form-grid account-basics">
              <Field label="Email address">
                <div className="discovery-email-field" data-found={lookup === "found" || undefined}>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    aria-describedby={lookup === "found" ? "discovery-success" : undefined}
                    value={draft.email}
                    onChange={(event) => changeEmail(event.target.value)}
                  />
                  {lookup === "found" && (
                    <span id="discovery-success" className="discovery-email-check">
                      <CheckCircle size={23} aria-hidden="true" />
                      <span hidden>Mail server settings found.</span>
                    </span>
                  )}
                </div>
              </Field>
              <Field label="Display name (optional)">
                <input
                  value={draft.displayName}
                  maxLength={256}
                  onChange={(event) =>
                    setDraft({ ...draft, displayName: event.target.value })
                  }
                />
              </Field>
            </div>
            {!initial.id && lookupMessage && (
              <p className="lookup-status" role="status">
                {lookupMessage}
              </p>
            )}
            {!separate && (
              <div className="form-grid">
                <LoginFields
                  auth={auth}
                  onChange={(value) => {
                    manualAuth.current = true;
                    setAuth(value);
                  }}
                />
              </div>
            )}
          </div>
          <div className="detail-section">
            <div className="server-options">
              <button
                className="secondary"
                type="button"
                aria-expanded={advanced}
                aria-controls="server-settings"
                onClick={() => setAdvanced(!advanced)}
              >
                <span className="disclosure-chevron" aria-hidden="true" />
                Server settings
              </button>
              {!initial.id &&
                domain &&
                (lookup === "failed" ||
                  lookup === "missing" ||
                  lookup === "partial") && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setRetry((value) => value + 1)}
                  >
                    Look up again
                  </button>
                )}
            </div>
            {!advanced && hasServers && (
              <dl className="server-summary">
                <div>
                  <dt>Incoming (IMAP)</dt>
                  <dd><code>{draft.incoming.host}</code><code className="server-summary-port">{draft.incoming.port}</code></dd>
                </div>
                <div>
                  <dt>Outgoing (SMTP)</dt>
                  <dd><code>{outgoingHost}</code><code className="server-summary-port">{draft.outgoing.port}</code></dd>
                </div>
              </dl>
            )}
            <div id="server-settings" hidden={!advanced}>
              {advanced && (
                <>
                  {!initial.id && (
                    <>
                      <div className="server-toggles">
                        <label>
                          <input
                            type="checkbox"
                            checked={sameHost}
                            onChange={(event) => {
                              manualSameHost.current = true;
                              setSameHost(event.target.checked);
                            }}
                          />{" "}
                          Use the incoming hostname for SMTP
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={separate}
                            onChange={(event) => {
                              const useSeparate = event.target.checked;
                              if (useSeparate) {
                                const login = {
                                  username: username.trim() || draft.email,
                                  auth,
                                };
                                setDraft({
                                  ...draft,
                                  incoming: { ...draft.incoming, ...login },
                                  outgoing: { ...draft.outgoing, ...login },
                                });
                              }
                              setSeparate(useSeparate);
                            }}
                          />{" "}
                          Use separate server logins
                        </label>
                      </div>
                      {!separate && (
                        <Field
                          label="Username"
                          hint="Leave blank to use your email address for both servers."
                        >
                          <input
                            value={username}
                            onChange={(event) =>
                              setUsername(event.target.value)
                            }
                            placeholder={draft.email || undefined}
                            autoComplete="off"
                          />
                        </Field>
                      )}
                    </>
                  )}
                  <ServerFields
                    server={draft.incoming}
                    editing={!!initial.id}
                    separate={separate}
                    onChange={(incoming) =>
                      changeServerSettings("incoming", incoming)
                    }
                  />
                  <ServerFields
                    outgoing
                    server={draft.outgoing}
                    editing={!!initial.id}
                    separate={separate}
                    sameHost={sameHost}
                    onChange={(outgoing) =>
                      changeServerSettings("outgoing", outgoing)
                    }
                  />
                </>
              )}
            </div>
          </div>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </fieldset>
      </div>
      <div className="dialog-actions editor-actions" data-floating-action={outsideAction && (outsideAction.saveWidth ? "both" : "cancel")}>
        <button
          type="button"
          ref={cancelButton}
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          ref={saveButton}
          className="primary"
          type="submit"
          disabled={busy}
          onClick={() => {
            if (!hasServers || separate) setAdvanced(true);
          }}
        >
          {busy ? <LoadingLabel>Saving…</LoadingLabel> : "Save account"}
        </button>
      </div>
      {outsideAction && createPortal(
        <div
          className="editor-outside-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Account editor actions"
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const { clientX, clientY } = event;
            const themeSwitch = document.elementsFromPoint(clientX, clientY)
              .map((element) => element.closest<HTMLButtonElement>(".profile-theme-switch"))
              .find((button) => button && !button.disabled);
            if (themeSwitch) {
              dismissOutsideAction();
              themeSwitch.click();
              return;
            }
            const editor = document.querySelector(".inline-editor")?.getBoundingClientRect();
            if (editor && clientX >= editor.left && clientX <= editor.right &&
                clientY >= editor.top && clientY <= editor.bottom) {
              dismissOutsideAction();
              return;
            }
            const follow = editorActionPosition(clientX, clientY, outsideAction.source);
            setOutsideAction({ ...outsideAction, follow });
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              dismissOutsideAction();
            }
            if (event.key === "Tab") {
              event.preventDefault();
              const buttons = Array.from(event.currentTarget.querySelectorAll("button"));
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const step = event.shiftKey ? -1 : 1;
              buttons[(index + step + buttons.length) % buttons.length]?.focus();
            }
          }}
        >
          <div
            className="editor-outside-actions"
            style={{
              left: outsideAction.left,
              top: outsideAction.top,
              gap: outsideAction.gap,
              minHeight: outsideAction.source.height,
              translate: outsideAction.follow
                ? `${outsideAction.follow.left - outsideAction.left}px ${outsideAction.follow.top - outsideAction.top}px`
                : "0px 0px",
              "--editor-action-from-x": `${outsideAction.source.left - outsideAction.left}px`,
              "--editor-action-from-y": `${outsideAction.source.top - outsideAction.top}px`,
            } as CSSProperties}
          >
            <button
              autoFocus={!outsideAction.saveWidth}
              type="button"
              className="editor-outside-button secondary"
              style={{ width: outsideAction.cancelWidth }}
              onClick={onCancel}
            >
              Cancel
            </button>
            {outsideAction.saveWidth > 0 && (
              <button
                autoFocus
                type="button"
                className="editor-outside-button primary"
                style={{ width: outsideAction.saveWidth }}
                onClick={() => {
                  dismissOutsideAction();
                  saveButton.current?.click();
                }}
              >
                Save account
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </form>
  );
}

const buttonStyles = [
  ["standard", "Standard"],
  ["primary", "Primary"],
  ["danger", "Destructive"],
  ["selection", "Selected avatar"],
] as const;
const exportButtonStyles = [
  ["export", "Export / Open import file"],
  ["export-hover", "Export / Open import file hover"],
  ["transfer-cancel", "Cancel transfer"],
  ["transfer-cancel-hover", "Cancel transfer hover"],
] as const;
const allButtonStyles = [...buttonStyles, ...exportButtonStyles] as const;
type ButtonStyle = (typeof allButtonStyles)[number][0];
type ButtonTint = { color: string; strength: number };
type ButtonPalette = Partial<Record<ButtonStyle, Partial<ButtonTint>>>;
type ButtonTheme = "light" | "dark";

function resolveButtonPalette(theme: ButtonTheme, overrides: ButtonPalette): Record<ButtonStyle, ButtonTint> {
  const neutral = theme === "light" ? { color: "#ffffff", strength: 24 } : { color: "#000000", strength: 12 };
  const standard = { ...neutral, ...overrides.standard };
  const selection = { color: "#b7ed60", strength: 100, ...overrides.selection };
  const exportTint = { ...selection, ...overrides.export };
  const darkerExport = tintChannels(exportTint.color)
    ?.map((channel) => Math.round(channel * 0.88).toString(16).padStart(2, "0"))
    .join("");
  return {
    standard,
    primary: { ...neutral, ...overrides.primary },
    danger: { color: "#ff526b", strength: 82, ...overrides.danger },
    selection,
    export: exportTint,
    "export-hover": {
      ...exportTint,
      color: darkerExport ? `#${darkerExport}` : exportTint.color,
      ...overrides["export-hover"],
    },
    "transfer-cancel": { ...standard, ...overrides["transfer-cancel"] },
    "transfer-cancel-hover": { color: "#f0bf33", strength: 90, ...overrides["transfer-cancel-hover"] },
  };
}

function loadButtonPalette(): Record<ButtonTheme, ButtonPalette> {
  const palette: Record<ButtonTheme, ButtonPalette> = { light: {}, dark: {} };
  try {
    const legacy = JSON.parse(localStorage.getItem("mailport.buttonGlassTint") ?? "{}");
    const stored = JSON.parse(localStorage.getItem("mailport.buttonPalette") ?? "{}");
    for (const theme of ["light", "dark"] as const) {
      const previousStrength = legacy?.[theme];
      if (Number.isInteger(previousStrength) && previousStrength >= 0 && previousStrength <= 100) {
        palette[theme].standard = { strength: previousStrength };
        palette[theme].primary = { strength: previousStrength };
      }
      for (const [style] of allButtonStyles) {
        const tint = stored?.[theme]?.[style];
        const override = { ...palette[theme][style] };
        // Replace the previous shipped neutral default while keeping custom colors.
        if (typeof tint?.color === "string" && /^#[0-9a-f]{6}$/i.test(tint.color)) {
          const oldSelectionDefault =
            style === "selection" &&
            tint.color.toLowerCase() === (theme === "light" ? "#323232" : "#dedede") &&
            tint.strength === 100;
          if (!oldSelectionDefault) override.color = tint.color;
        }
        if (Number.isInteger(tint?.strength) && tint.strength >= 0 && tint.strength <= 100) {
          override.strength = tint.strength;
        }
        if (override.color !== undefined || override.strength !== undefined) {
          palette[theme][style] = override;
        }
      }
    }
  } catch {
    // Use the defaults if a preference cannot be read.
  }
  return palette;
}

const surfaceControls = [
  ["shell", "Outer shell"],
  ["sidebars", "Sidebars"],
  ["detail", "Detail pane"],
  ["modal", "Modal opacity"],
] as const;
const transparencyDefaults = {
  light: { shell: 45, sidebars: 62, detail: 0, modal: 46 },
  dark: { shell: 59, sidebars: 98, detail: 73, modal: 21 },
};

function loadSurfaceTransparency() {
  try {
    const stored = JSON.parse(localStorage.getItem("mailport.surfaceTransparency") ?? "{}");
    const next = structuredClone(transparencyDefaults);
    for (const theme of ["light", "dark"] as const) {
      for (const [surface] of surfaceControls) {
        const value = stored?.[theme]?.[surface];
        if (Number.isInteger(value) && value >= 0 && value <= 100) {
          next[theme][surface] = value;
        }
      }
    }
    return next;
  } catch {
    return transparencyDefaults;
  }
}

function AppearanceSlider({ id, theme, label, value, onChange }: {
  id: string;
  theme: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const update = useRef(onChange);
  useEffect(() => { update.current = onChange; }, [onChange]);
  useEffect(() => {
    if (!document.documentElement.classList.contains("is-mac")) return;
    let active = true;
    const unsubscribe = listen<{ id: string; value: number }>("vault-slider-change", ({ payload }) => {
      if (active && payload.id === id) update.current(payload.value);
    });
    return () => {
      active = false;
      void unsubscribe.then((stop) => stop()).catch(() => {});
    };
  }, [id]);
  return (
    <label className="glass-tint-slider">
      <span className="appearance-slider-label">{label}</span>
      <span
        className="appearance-slider-track"
        data-slider-id={id}
        data-slider-label={`${theme} mode, ${label}`}
        data-slider-value={value}
      >
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          aria-valuetext={`${value} percent`}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
      </span>
      <span aria-hidden="true">{value}%</span>
    </label>
  );
}

function AccountServer({
  protocol,
  label,
  server,
}: {
  protocol: string;
  label: string;
  server: Connection;
}) {
  return (
    <section className="account-card-server" aria-label={`${label} mail`}>
      <h3>
        <span className="account-card-protocol">{protocol}</span>
        {label}
      </h3>
      <code className="account-card-host">{server.host}</code>
      <dl>
        <div>
          <dt>Port</dt>
          <dd>{server.port}</dd>
        </div>
        <div>
          <dt>Security</dt>
          <dd>{securityLabel(server.security)}</dd>
        </div>
        <div>
          <dt>Username</dt>
          <dd><code>{server.username}</code></dd>
        </div>
      </dl>
    </section>
  );
}

function AccountDetailCard({
  account,
  profiles,
  busy,
  selected,
  onEdit,
  onChooseProfile,
}: {
  account: Summary;
  profiles: Profile[];
  busy: boolean;
  selected: boolean;
  onEdit: () => void;
  onChooseProfile: (profileId: string | null) => void;
}) {
  const headingId = `account-card-heading-${account.id}`;
  return (
    <article
      className="account-card"
      aria-labelledby={headingId}
      data-selected={selected ? "" : undefined}
    >
      <header className="account-card-header">
        {profiles.length > 0 ? (
          <AccountProfilePicker
            key={account.id}
            profiles={profiles}
            profileId={account.profileId}
            email={account.email}
            disabled={busy}
            onChoose={onChooseProfile}
          />
        ) : (
          <span className="profile-avatar account-card-avatar" aria-hidden="true">
            <Icon name="mail" size={24} />
          </span>
        )}
        <div className="account-card-identity">
          <h2 id={headingId}>{account.displayName || account.email}</h2>
          {account.displayName && <p>{account.email}</p>}
        </div>
        <button
          className="secondary account-card-edit"
          data-edit-id={account.id}
          data-control-glass
          disabled={busy}
          onClick={onEdit}
        >
          <Icon name="edit" size={16} /> Edit
        </button>
      </header>
      <div className="account-card-servers">
        <AccountServer protocol="IMAP" label="Incoming" server={account.incoming} />
        <AccountServer protocol="SMTP" label="Outgoing" server={account.outgoing} />
      </div>
      <footer className="account-card-footer">
        <span>Authentication</span>
        <span className="account-card-auth">
          <span
            className="account-card-status"
            data-pending={account.requiresSignIn ? "" : undefined}
            aria-hidden="true"
          />
          {account.requiresSignIn
            ? "Sign in with your provider"
            : "Password saved in MailPort"}
        </span>
      </footer>
    </article>
  );
}

export default function App() {
  const [light, setLight] = useState(isLightScheme);
  const [buttonPalette, setButtonPalette] = useState(loadButtonPalette);
  const buttonTheme = light ? "light" : "dark";
  const activePalette = useMemo(
    () => resolveButtonPalette(buttonTheme, buttonPalette[buttonTheme]),
    [buttonPalette, buttonTheme],
  );
  const updateButtonTint = (style: ButtonStyle, change: Partial<ButtonTint>) =>
    setButtonPalette((previous) => ({
      ...previous,
      [buttonTheme]: {
        ...previous[buttonTheme],
        [style]: { ...previous[buttonTheme][style], ...change },
      },
    }));
  const [transparency, setTransparency] = useState(loadSurfaceTransparency);
  const activeTransparency = transparency[light ? "light" : "dark"];
  useEffect(() => {
    for (const [surface] of surfaceControls) {
      document.documentElement.style.setProperty(
        `--vault-${surface}-opacity`,
        String((surface === "modal" ? activeTransparency.modal : 100 - activeTransparency[surface]) / 100),
      );
    }
  }, [activeTransparency]);
  useEffect(() => {
    try {
      localStorage.setItem("mailport.surfaceTransparency", JSON.stringify(transparency));
    } catch {
      // Preferences are still available for this session.
    }
  }, [transparency]);

  useEffect(() => {
    const root = document.documentElement.style;
    for (const [style] of allButtonStyles) {
      root.setProperty(`--vault-button-${style}-color`, activePalette[style].color);
      root.setProperty(`--vault-button-${style}-strength`, String(activePalette[style].strength));
    }
  }, [activePalette]);
  useEffect(() => {
    try {
      localStorage.setItem("mailport.buttonPalette", JSON.stringify(buttonPalette));
    } catch {
      // The preview still works when preferences cannot be stored.
    }
  }, [buttonPalette]);
  useEffect(() => {
    const update = () => setLight(isLightScheme());
    window.addEventListener(SCHEME_CHANGE_EVENT, update);
    return () => window.removeEventListener(SCHEME_CHANGE_EVENT, update);
  }, []);
  const nextTheme = light ? "dark" : "light";
  const [status, setStatus] = useState<Status | null>(null);
  const [autoLock, setAutoLock] = useState<AutoLockState | null>(null);
  const [autoLockBusy, setAutoLockBusy] = useState(false);
  const [autoLockHover, setAutoLockHover] = useState(false);
  const [autoLockFocus, setAutoLockFocus] = useState(false);
  const autoLockChanging = useRef(false);
  const autoLockRevision = useRef(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [passphraseState, setPassphraseState] = useState<
    "idle" | "pending" | "verified"
  >("idle");
  const [passphraseError, setPassphraseError] = useState<PassphraseError>();
  const unlockForm = useRef<HTMLFormElement>(null);
  const manualUnlock = useRef(false);
  const passphraseHidden =
    passphraseState === "pending" || passphraseState === "verified";
  useEffect(() => {
    if (!busy && !passphraseHidden && passphraseError) {
      unlockForm.current
        ?.querySelector<HTMLInputElement>(`input[name="${passphraseError.field}"]`)
        ?.focus();
    }
  }, [busy, passphraseHidden, passphraseError]);
  const [quickUnlockMethod, setQuickUnlockMethod] = useState<QuickMethod>();
  const [pendingMove, setPendingMove] = useState<{
    accountId: string;
    profileId: string | null;
  }>();
  const [activeId, setActiveId] = useState<string>();
  const [scrollAccount, setScrollAccount] = useState<{ id: string }>();
  const detailPane = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [unlockSettings, setUnlockSettings] = useState(false);
  const [editor, setEditor] = useState<Account | null>(null);
  const [deleteIds, setDeleteIds] = useState<string[]>([]);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteFocus = useRef<string | null>(null);
  const [transfer, setTransfer] = useState<TransferPane | null>(null);
  const [transferAction, setTransferAction] = useState<"choose" | "save">();
  const [transferError, setTransferError] = useState("");
  const transferFocus = useRef<string | null>(null);
  const transferDocument = useRef<HTMLImageElement>(null);
  const transferFolder = useRef<HTMLSpanElement>(null);
  const [profileEditor, setProfileEditor] = useState<Profile | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string>();
  const [profilesCollapsed, setProfilesCollapsed] = useState(true);
  const [exportCollapsed, setExportCollapsed] = useState(false);
  const [modalError, setModalError] = useState("");
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (
      !busy &&
      !editor &&
      !profileEditor &&
      !unlockSettings &&
      returnFocus.current
    ) {
      document.querySelector<HTMLElement>(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [busy, editor, profileEditor, unlockSettings]);
  const openSettings = () => {
    returnFocus.current = "#quick-unlock-settings";
    setUnlockSettings(true);
    setError("");
  };
  const canOpenSettings =
    status?.unlocked &&
    !busy &&
    !editor &&
    !profileEditor;
  useEffect(() => {
    if (
      !canOpenSettings ||
      !document.documentElement.classList.contains("is-mac")
    )
      return;
    const handleShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        !event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.key !== ","
      )
        return;
      event.preventDefault();
      openSettings();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [canOpenSettings]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const refresh = async (fromPoll = false) => {
    const next = await invoke<Status>("vault_status");
    if (fromPoll && manualUnlock.current) return;
    setStatus(next);
    if (!next.unlocked) {
      setAutoLock(null);
      toast.dismiss();
      setUnlockSettings(false);
      setActiveId(undefined);
      setSelected([]);
      setEditor(null);
      setTransfer(null);
      setDeleteIds([]);
      setProfileEditor(null);
      setActiveProfileId(undefined);
      setModalError("");
    }
  };
  useEffect(() => {
    saveInsetLayout(false);
    saveBodyGlass(true);
    document.documentElement.classList.add("glass-body");
    const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const appearanceFrame = requestAnimationFrame(activateWindowAppearance);
    transparency.addEventListener("change", activateWindowAppearance);
    void refresh().catch(() =>
      setError(
        "MailPort could not reach its local vault. Open the desktop application to continue.",
      ),
    );
    const timer = window.setInterval(() => {
      const update = async () => {
        if (manualUnlock.current) return;
        if (!statusRef.current?.unlocked) {
          await refresh(true);
        } else if (!autoLockChanging.current) {
          const revision = autoLockRevision.current;
          const state = await invoke<AutoLockState | null>("vault_auto_lock_state");
          if (autoLockChanging.current || revision !== autoLockRevision.current) return;
          if (state) setAutoLock(state);
          else await refresh(true);
        }
      };
      void update().catch(() => {});
    }, 1000);
    let touched = 0;
    const touch = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".auto-lock-control")) return;
      if (statusRef.current?.unlocked && Date.now() - touched > 15000) {
        touched = Date.now();
        void invoke("vault_touch").catch(() => {});
      }
    };
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      clearInterval(timer);
      cancelAnimationFrame(appearanceFrame);
      transparency.removeEventListener("change", activateWindowAppearance);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
    };
  }, []);
  const toggleAutoLock = async () => {
    if (!autoLock || autoLockChanging.current) return;
    autoLockRevision.current += 1;
    autoLockChanging.current = true;
    setAutoLockBusy(true);
    try {
      setAutoLock(await invoke<AutoLockState>("vault_set_auto_lock_paused", { paused: !autoLock.paused }));
    } catch {
      setError("Could not change auto-lock. Check the vault and try again.");
      await refresh().catch(() => {});
    } finally {
      autoLockChanging.current = false;
      setAutoLockBusy(false);
    }
  };
  const editing = editor !== null;
  const isMac = document.documentElement.classList.contains("is-mac");
  useEffect(() => {
    if (unlockSettings)
      document.getElementById("quick-unlock-heading")?.focus();
  }, [unlockSettings]);
  useEffect(() => {
    if (editing) document.getElementById("editor-heading")?.focus();
  }, [editing]);
  useEffect(() => {
    if (!isMac) return;
    let active = true;
    const update = () => {
      void invoke<[number, number, number] | null>("system_accent_color")
        .then((color) => {
          if (active && color) {
            document.documentElement.style.setProperty(
              "--system-vault-accent",
              `rgb(${color.join(" ")})`,
            );
          }
        })
        .catch(() => {});
    };
    const appearance = matchMedia("(prefers-color-scheme: dark)");
    appearance.addEventListener("change", update);
    window.addEventListener("focus", update);
    update();
    return () => {
      active = false;
      appearance.removeEventListener("change", update);
      window.removeEventListener("focus", update);
    };
  }, [isMac]);
  useNativeButtonGlass();
  const run = async (
    operation: () => Promise<void>,
    onError: (message: string) => void = setError,
  ) => {
    setBusy(true);
    setError("");
    setModalError("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      const message =
        typeof e === "string"
          ? e
          : "The operation could not finish. Try again.";
      onError(message);
    } finally {
      setBusy(false);
    }
  };
  const unlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password") ?? "");
    const encoded = new TextEncoder().encode(password);
    const tooLong = encoded.length > 1024;
    encoded.fill(0);
    setError("");
    if (password.length < 12 || tooLong) {
      setPassphraseError({
        field: "password",
        message: !password ? "Enter your master passphrase."
          : tooLong ? "Use at most 1,024 UTF-8 bytes." : "Use at least 12 characters.",
      });
      return;
    }
    if (!status?.exists && password !== fields.get("confirm")) {
      setPassphraseError({ field: "confirm", message: "The passphrases don’t match. Try again." });
      return;
    }
    setPassphraseError(undefined);
    form.reset();
    manualUnlock.current = true;
    if (status?.exists) setPassphraseState("pending");
    void run(async () => {
      await invoke(status?.exists ? "vault_unlock" : "vault_create", { password });
      if (status?.exists && document.visibilityState === "visible") {
        setPassphraseState("verified");
        await new Promise<void>((resolve) => window.setTimeout(resolve, 250));
      }
    }, (message) => {
      if (status?.exists && message.startsWith("Could not unlock. Check the password")) {
        setPassphraseError({
          field: "password",
          message: "Couldn’t unlock with that passphrase. Check it and try again.",
        });
      } else {
        setError(message);
      }
    }).finally(() => {
      manualUnlock.current = false;
      setPassphraseState("idle");
    });
  };
  const quickUnlock = (method: QuickMethod) => {
    if (busy) return;
    setPassphraseError(undefined);
    setQuickUnlockMethod(method);
    void run(() => invoke<void>("vault_quick_unlock", { method })).finally(() =>
      setQuickUnlockMethod(undefined),
    );
  };
  const configureQuickUnlock = (
    method: QuickMethod,
    enabled: boolean,
    reference?: string,
  ) =>
    run(() =>
      invoke<void>("vault_configure_quick_unlock", {
        method,
        enabled,
        reference,
      }),
    );
  const lock = () => {
    setEditor(null);
    setTransfer(null);
    setSelected([]);
    void run(async () => {
      await invoke("vault_lock");
    });
  };
  const openAccount = (id: string) => {
    setUnlockSettings(false);
    setActiveId(id);
    setScrollAccount({ id });
  };
  const edit = (id?: string, trigger = "#add-account") => {
    returnFocus.current = id ? `[data-edit-id="${id}"]` : trigger;
    setModalError("");
    if (!id) setEditor(newAccount());
    else
      void run(async () =>
        setEditor(await invoke<Account>("vault_account", { id })),
      );
  };
  const toggle = (id: string) =>
    setSelected((ids) =>
      ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id],
    );
  const openTransfer = () => {
    transferFocus.current = "#export-stage-heading";
    setExportCollapsed(false);
    if (!transfer) {
      setTransferError("");
      setTransfer({ stage: "request" });
    }
  };
  const closeTransfer = () => {
    transferFocus.current = "#export-accounts";
    setTransfer(null);
    setTransferError("");
  };
  const chooseImportRequest = () => {
    transferFocus.current = "#transfer-choose-request";
    setTransferError("");
    setTransferAction("choose");
    void run(async () => {
      const recipient = await invoke<ExportRecipient | null>("vault_load_import_request");
      if (recipient) {
        transferFocus.current = "#export-stage-heading";
        setTransfer({ stage: "review", recipient });
      }
    }, setTransferError).finally(() => setTransferAction(undefined));
  };
  const saveTransfer = () => {
    if (transfer?.stage !== "review" || busy || editing) return;
    const { requestFile, verificationCode } = transfer.recipient;
    transferFocus.current = "#transfer-approve";
    setTransferError("");
    setTransferAction("save");
    void run(async () => {
      const saved = await invoke<SavedTransfer | null>("vault_export", {
        ids: selected,
        requestFile,
        verifiedCode: verificationCode,
      });
      if (saved) {
        transferFocus.current = "#export-stage-heading";
        setTransfer({ stage: "saved", ...saved });
      }
    }, setTransferError).finally(() => setTransferAction(undefined));
  };
  const savedAccounts = status?.unlocked ? status.accounts : [];
  const allAccounts = pendingMove
    ? savedAccounts.map((account) =>
        account.id === pendingMove.accountId
          ? { ...account, profileId: pendingMove.profileId }
          : account,
      )
    : savedAccounts;
  const profiles = status?.unlocked ? status.profiles : [];
  const activeProfile = profiles.find(
    (profile) => profile.id === activeProfileId,
  );
  const accounts = activeProfile
    ? allAccounts.filter((account) => account.profileId === activeProfile.id)
    : allAccounts;
  const active =
    accounts.find((account) => account.id === activeId) ?? accounts[0];
  const visibleCards = accounts.filter(
    (account) => account.id === active?.id || selected.includes(account.id),
  );
  const selectedAccounts = allAccounts.filter(({ id }) =>
    selected.includes(id),
  );
  const hasSelection = selectedAccounts.length > 0;
  useEffect(() => {
    if (!scrollAccount) return;
    const pane = detailPane.current;
    const card = document.getElementById(`account-card-heading-${scrollAccount.id}`)?.closest(".account-card");
    if (!pane || !card) return;
    pane.scrollTo({
      top: pane.scrollTop + card.getBoundingClientRect().top - pane.getBoundingClientRect().top - 24,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [scrollAccount]);
  useEffect(() => {
    if (!hasSelection) {
      transferFocus.current = null;
      setExportCollapsed(false);
      setTransfer(null);
    }
  }, [hasSelection]);
  useEffect(() => {
    if (!busy && transferFocus.current) {
      document.querySelector<HTMLElement>(transferFocus.current)?.focus();
      transferFocus.current = null;
    }
  }, [busy, transfer, exportCollapsed]);
  useEffect(() => {
    if (transfer?.stage !== "saved" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const source = transferDocument.current;
    const folder = transferFolder.current;
    if (!source || !folder) return;
    const from = source.getBoundingClientRect();
    const to = folder.getBoundingClientRect();
    if (!from.width || !to.width) return;

    const flight = document.createElement("img");
    flight.className = "transfer-flying-icon";
    flight.src = source.currentSrc || source.src;
    flight.alt = "";
    flight.setAttribute("aria-hidden", "true");
    const x = to.left + (to.width - from.width) / 2 - from.left;
    const y = to.top + (to.height - from.height) / 2 - from.top;
    Object.assign(flight.style, {
      left: `${from.left}px`,
      top: `${from.top}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    flight.style.setProperty("--transfer-flight-x", `${x}px`);
    flight.style.setProperty("--transfer-flight-y", `${y}px`);
    document.body.append(flight);
    flight.addEventListener("animationend", () => flight.remove(), { once: true });
    return () => flight.remove();
  }, [transfer]);
  const visibleSelection = accounts.filter(({ id }) => selected.includes(id));
  const exportGroups = [
    ...profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      accounts: selectedAccounts.filter(
        (account) => account.profileId === profile.id,
      ),
    })),
    {
      id: "ungrouped",
      name: "Ungrouped",
      accounts: selectedAccounts.filter(
        (account) => !profiles.some(({ id }) => id === account.profileId),
      ),
    },
  ].filter((group) => group.accounts.length);
  const hasProfileGroups = exportGroups.some(({ id }) => id !== "ungrouped");

  const deleteAccounts = allAccounts.filter((account) =>
    deleteIds.includes(account.id),
  );
  const reviewingDeletion = deleteAccounts.length > 0;
  useEffect(() => {
    deleteFocus.current = null;
    setDeleteIds((ids) => ids.length ? [] : ids);
    setDeleteError("");
  }, [selected, activeProfileId, editing, unlockSettings]);
  useEffect(() => {
    if (!busy && deleteFocus.current) {
      document.querySelector<HTMLElement>(deleteFocus.current)?.focus();
      deleteFocus.current = null;
    }
  }, [busy, deleteIds]);
  const moveAccount = (accountId: string, profileId: string | null) => {
    if (
      busy ||
      !savedAccounts.some(
        (account) =>
          account.id === accountId && account.profileId !== profileId,
      )
    )
      return;
    setPendingMove({ accountId, profileId });
    void run(async () => {
      await invoke("vault_move_account", { accountId, profileId });
      setStatus((current) =>
        current?.unlocked
          ? {
              ...current,
              accounts: current.accounts.map((account) =>
                account.id === accountId ? { ...account, profileId } : account,
              ),
            }
          : current,
      );
      toast.success("Account moved.");
    }).finally(() => setPendingMove(undefined));
  };
  const reviewDeletion = (ids: string[]) => {
    deleteFocus.current = "#delete-review-heading";
    setDeleteError("");
    setDeleteIds(ids);
  };
  const cancelDeletion = () => {
    deleteFocus.current = visibleSelection.length ? "#delete-accounts" : "#account-heading";
    setDeleteError("");
    setDeleteIds([]);
  };
  const deleteReviewedAccounts = () => {
    if (busy || editing || !reviewingDeletion || deleteAccounts.length !== deleteIds.length) return;
    setDeleteError("");
    setDeleting(true);
    void run(async () => {
      await invoke("vault_delete_accounts", { ids: deleteIds });
      returnFocus.current = "#account-heading";
      setSelected((ids) => ids.filter((id) => !deleteIds.includes(id)));
      setDeleteIds([]);
      toast.success(deleteIds.length === 1 ? "Account deleted." : "Accounts deleted.");
    }, (message) => {
      deleteFocus.current = "#delete-confirm";
      setDeleteError(message);
    }).finally(() => setDeleting(false));
  };
  const { draggedId, dropTarget, start, paintCard } = useAccountDrag(
    Boolean(status?.unlocked && !busy && !editing && !deleteIds.length),
    (accountId, destination) => {
      if (destination === "delete") {
        reviewDeletion([accountId]);
      } else if (profiles.some(({ id }) => id === destination)) {
        moveAccount(accountId, destination);
      }
    },
  );
  const carried = allAccounts.find(({ id }) => id === draggedId);
  const targetProfile = profiles.find(({ id }) => id === dropTarget);

  const selectProfile = (id?: string) => {
    setActiveProfileId(id);
    setActiveId(undefined);
    setUnlockSettings(false);
    setError("");
  };
  const openProfileEditor = (profile: Profile, trigger: string) => {
    returnFocus.current = trigger;
    setModalError("");
    setProfileEditor(profile);
  };

  return (
    <div className="vault-app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="drag-strip" data-tauri-drag-region>
        <span className="window-title" data-tauri-drag-region>
          <img
            src="/mailport-logo.png"
            width={16}
            height={18}
            alt=""
            data-tauri-drag-region
          />
          MailPort Vault
        </span>
      </header>
      <main
        id="main-content"
        className={
          status?.unlocked
            ? `vault-main is-unlocked${profilesCollapsed ? " profiles-collapsed" : ""}${hasSelection ? (exportCollapsed ? " export-collapsed" : " export-expanded") : " no-export-sidebar"}`
            : "vault-main"
        }
        tabIndex={-1}
      >
        {!status ? (
          <div className="welcome" role={error ? "alert" : "status"}>
            {error || "Opening vault…"}
          </div>
        ) : !status.unlocked ? (
          <div className="welcome">
            <div className="welcome-emblem">
              <img
                src="/mailport-logo.png"
                width={82}
                height={93}
                alt="MailPort"
              />
            </div>
            {!status.exists && <h1>Create a vault</h1>}
            {!status.exists && (
              <p>Your accounts are encrypted and stored on this device.</p>
            )}
            <form
              ref={unlockForm}
              className="unlock-form"
              data-passphrase-state={passphraseState}
              onSubmit={unlock}
              noValidate
            >
              <fieldset disabled={busy}>
                <div
                  className="passphrase-fields"
                  aria-hidden={passphraseHidden || undefined}
                >
                  <div className="passphrase-fields-content">
                    <PasswordFields
                      creating={!status.exists}
                      issue={passphraseError}
                      onInput={(field) => {
                        if (passphraseError?.field === field || field === "password") {
                          setPassphraseError(undefined);
                        }
                        if (error) setError("");
                      }}
                    />
                  </div>
                </div>
                {!status.exists && (
                  <p className="field-hint">
                    Use at least 12 characters. Keep a copy of your
                    passphrase somewhere safe; MailPort cannot recover it.
                  </p>
                )}
                {error && (
                  <p
                    id="unlock-error"
                    className="error-banner"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button className="primary unlock-submit" type="submit">
                  {busy && !quickUnlockMethod ? (
                    <LoadingLabel>
                      {passphraseState === "verified"
                        ? "Passphrase verified"
                        : status.exists
                          ? "Opening vault…"
                          : "Creating vault…"}
                    </LoadingLabel>
                  ) : status.exists ? (
                    "Unlock vault"
                  ) : (
                    "Create vault"
                  )}
                </button>
              </fieldset>
            </form>
            {isMac &&
              status.exists &&
              (status.touchIdEnabled || status.onePasswordEnabled) && (
                <div className="quick-unlock-actions">
                  {status.touchIdEnabled && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => quickUnlock("touchId")}
                    >
                      {quickUnlockMethod === "touchId" ? (
                        <LoadingLabel>Opening vault…</LoadingLabel>
                      ) : (
                        "Unlock with Touch ID"
                      )}
                    </button>
                  )}
                  {status.onePasswordEnabled && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => quickUnlock("onePassword")}
                    >
                      {quickUnlockMethod === "onePassword" ? (
                        <LoadingLabel>Opening vault…</LoadingLabel>
                      ) : (
                        "Unlock with 1Password"
                      )}
                    </button>
                  )}
                </div>
              )}
            <p className="unlock-note">
              Use sample accounts while security review is pending.
            </p>
          </div>
        ) : (
          <>
            <nav
              className="profile-sidebar"
              aria-label="Profiles"
              data-account-dragging={draggedId ? "" : undefined}
            >
              <div className="profile-nav-heading">
                <span className="profile-label">Profiles</span>
                <button
                  type="button"
                  className="icon-button profile-collapse"
                  aria-label={
                    profilesCollapsed ? "Expand profiles" : "Collapse profiles"
                  }
                  title={
                    profilesCollapsed ? "Expand profiles" : "Collapse profiles"
                  }
                  aria-expanded={!profilesCollapsed}
                  onClick={() =>
                    setProfilesCollapsed((collapsed) => !collapsed)
                  }
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.65"
                    aria-hidden="true"
                  >
                    <rect x="3" y="5" width="18" height="14" rx="3" />
                    <path d="M9 5v14" />
                  </svg>
                </button>
              </div>
              <div className="profile-items">
                <button
                  id="all-accounts"
                  className="profile-link"
                  aria-label="All accounts"
                  title={profilesCollapsed ? "All accounts" : undefined}
                  aria-current={
                    !unlockSettings && !activeProfile ? "page" : undefined
                  }
                  disabled={busy || editing}
                  onClick={() => selectProfile()}
                >
                  <span className="profile-avatar">
                    <Icon name="mail" size={17} />
                  </span>
                  <span className="profile-link-label">All accounts</span>
                </button>
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    data-profile-drop-target
                    data-account-drop={profile.id}
                    data-drop-active={
                      dropTarget === profile.id ? "" : undefined
                    }
                    type="button"
                    className="profile-link"
                    aria-label={profile.name}
                    title={profile.name}
                    aria-current={
                      !unlockSettings && activeProfileId === profile.id
                        ? "page"
                        : undefined
                    }
                    disabled={busy || editing}
                    onClick={() => selectProfile(profile.id)}
                  >
                    <ProfileAvatar profile={profile} neutral={hasSelection} />
                    <span className="profile-link-label">{profile.name}</span>
                  </button>
                ))}
              </div>
              <button
                id="add-profile"
                type="button"
                className="profile-link"
                aria-label="Add profile"
                title="Add profile"
                disabled={busy || editing}
                onClick={() => openProfileEditor(newProfile(), "#add-profile")}
              >
                <span className="profile-avatar">
                  <Icon name="plus" size={17} />
                </span>
                <span className="profile-link-label">Add profile</span>
              </button>
              <button
                type="button"
                className="profile-link profile-theme-switch"
                aria-label={`Switch to ${nextTheme} mode`}
                title={`Switch to ${nextTheme} mode`}
                onClick={() => {
                  saveThemePreference(nextTheme);
                  applyThemePreference(nextTheme);
                }}
              >
                <span className="profile-avatar">
                  <Icon name={light ? "moon" : "sun"} size={17} />
                </span>
                <span className="profile-link-label profile-theme-label">
                  <span>Switch to</span>
                  <strong>{light ? "Dark mode" : "Light mode"}</strong>
                </span>
              </button>
              {isMac && (
                <button
                  id="quick-unlock-settings"
                  className="profile-link profile-settings"
                  aria-label="Settings"
                  title={profilesCollapsed ? "Settings" : undefined}
                  aria-keyshortcuts="Meta+,"
                  disabled={busy || editing}
                  aria-current={unlockSettings ? "page" : undefined}
                  onClick={openSettings}
                >
                  <span className="profile-avatar">
                    <Icon name="gear" size={17} />
                  </span>
                  <span className="profile-link-label">Settings</span>
                </button>
              )}
              <div className="profile-lock-footer">
                <button
                  type="button"
                  className="profile-link"
                  aria-label="Lock vault"
                  title={profilesCollapsed ? "Lock vault" : undefined}
                  onClick={lock}
                  disabled={busy}
                >
                  <span className="profile-avatar">
                    <Icon name="lock" size={17} />
                  </span>
                  <span className="profile-link-label">Lock vault</span>
                </button>
                <div
                  className={`auto-lock-control${autoLockHover || autoLockFocus ? " is-revealed" : ""}`}
                  aria-label="Auto-lock timer"
                >
                  <span className="auto-lock-time" aria-label={autoLock?.paused ? "Auto-lock paused" : "Time until auto-lock"}>
                    {autoLock ? `${Math.floor(autoLock.remainingSeconds / 60)}:${String(autoLock.remainingSeconds % 60).padStart(2, "0")}` : "–:––"}
                  </span>
                  <button
                    type="button"
                    className="auto-lock-pause"
                    data-control-glass
                    aria-label={autoLock?.paused ? "Resume auto-lock" : "Pause auto-lock"}
                    aria-pressed={autoLock?.paused ?? false}
                    title={autoLock?.paused ? "Resume auto-lock" : "Pause auto-lock"}
                    disabled={!autoLock || autoLockBusy || busy}
                    onPointerEnter={(event) => { if (event.pointerType !== "touch") setAutoLockHover(true); }}
                    onPointerLeave={() => setAutoLockHover(false)}
                    onFocus={() => setAutoLockFocus(true)}
                    onBlur={() => setAutoLockFocus(false)}
                    onClick={() => void toggleAutoLock()}
                  >
                    {autoLock?.paused ? (
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M3.5 2.2 9.5 6l-6 3.8z" fill="currentColor" /></svg>
                    ) : (
                      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12"><path d="M3.4 2.2h1.8v7.6H3.4zm3.4 0h1.8v7.6H6.8z" fill="currentColor" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </nav>
            <section className="account-pane" aria-labelledby="account-heading">
              <div className="pane-heading">
                <h1 id="account-heading" tabIndex={-1} className="account-pane-title" aria-label={activeProfile?.name ?? "Accounts"}>
                  {visibleSelection.length > 0 ? (
                    <span className="account-heading-selected">
                      <span className="selection-count">{visibleSelection.length}</span>
                      <span>{visibleSelection.length === 1 ? "Account Selected" : "Accounts Selected"}</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      role="checkbox"
                      className="account-heading-select"
                      aria-checked={false}
                      aria-label="Select All"
                      disabled={busy || editing || !accounts.length}
                      onClick={() =>
                        setSelected((previous) => [
                          ...new Set([...previous, ...accounts.map(({ id }) => id)]),
                        ])
                      }
                    >
                      <span className="account-heading-name">
                        {activeProfile?.name ?? "Accounts"}
                        <span className="selection-count">{accounts.length}</span>
                      </span>
                      <span className="account-heading-select-label">
                        <span>Select All</span>
                        <span className="account-heading-checkbox" aria-hidden="true" />
                      </span>
                    </button>
                  )}
                </h1>
                {activeProfile && (
                  <button
                    id="edit-profile"
                    type="button"
                    className="icon-button profile-edit"
                    aria-label="Edit profile"
                    title="Edit profile"
                    disabled={busy || editing}
                    onClick={() =>
                      openProfileEditor(activeProfile, "#edit-profile")
                    }
                  >
                    <Icon name="edit" size={16} />
                  </button>
                )}
                <button
                  id="add-account"
                  data-control-glass
                  className="icon-button"
                  aria-label={hasSelection ? "Clear selection" : "Add account"}
                  title={hasSelection ? "Clear selection" : "Add account"}
                  disabled={busy || editing}
                  onClick={() => {
                    if (hasSelection) {
                      setSelected([]);
                      return;
                    }
                    setUnlockSettings(false);
                    edit();
                  }}
                >
                  <Icon name={hasSelection ? "close" : "plus"} size={19} />
                </button>
              </div>
              {accounts.length > 0 && (
                <>
                  <ul className="account-list">
                    {accounts.map((account) => (
                      <li
                        key={account.id}
                        className={
                          active?.id === account.id ? "current-account" : ""
                        }
                      >
                        <button
                          type="button"
                          role="checkbox"
                          className="secondary account-select-avatar"
                          aria-checked={selected.includes(account.id)}
                          aria-label={`Select ${account.email} for export`}
                          disabled={busy}
                          onClick={() => toggle(account.id)}
                        >
                          {selected.includes(account.id) ? (
                            <>
                              <span className="account-selection-filled account-select-all-check"><Icon name="check" size={15} /></span>
                              <span className="account-selection-filled account-select-all-clear"><Icon name="close" size={15} /></span>
                            </>
                          ) : (
                            <>
                              <span className="account-avatar-initial" aria-hidden="true">
                                {Array.from(account.displayName.trim() || account.email)[0]?.toLocaleUpperCase()}
                              </span>
                              <span className="account-select-ring" aria-hidden="true" />
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          className="account-button"
                          disabled={editing}
                          aria-current={
                            active?.id === account.id ? "true" : undefined
                          }
                          aria-label={
                            account.displayName
                              ? `${account.displayName}, ${account.email}`
                              : account.email
                          }
                          onClick={() => {
                            openAccount(account.id);
                          }}
                        >
                          <strong>
                            {account.displayName || account.email}
                          </strong>
                          {account.displayName && <span>{account.email}</span>}
                        </button>
                        <span
                          className="account-grab"
                          aria-hidden="true"
                          data-grabbable={!busy && !editing && !reviewingDeletion ? "" : undefined}
                          onPointerDown={(event) => start(event, account.id)}
                        >
                          <Icon name="grab" size={16} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {reviewingDeletion && (
                <section
                  className="account-delete-review"
                  aria-labelledby="delete-review-heading"
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && !busy) {
                      event.preventDefault();
                      cancelDeletion();
                    }
                  }}
                >
                  <div className="account-delete-copy">
                    <h2 id="delete-review-heading" tabIndex={-1}>
                      {deleteAccounts.length === 1 ? "Delete account?" : `Delete ${deleteAccounts.length} accounts?`}
                    </h2>
                    <ul aria-label="Accounts to delete">
                      {deleteAccounts.map(({ id, email }) => <li key={id}>{email}</li>)}
                    </ul>
                    <p>Remove these settings and credentials from MailPort. Your mailboxes stay with their providers.</p>
                    {deleteError && <p className="error-banner" role="alert">{deleteError}</p>}
                  </div>
                  <footer className="account-delete-area">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label="Cancel deletion"
                      title="Cancel deletion"
                      disabled={busy}
                      onClick={cancelDeletion}
                    >
                      <Icon name="close" size={16} />
                    </button>
                    <button
                      id="delete-confirm"
                      className="secondary danger-button"
                      type="button"
                      disabled={busy || editing}
                      onClick={deleteReviewedAccounts}
                    >
                      {deleting ? <LoadingLabel>Deleting…</LoadingLabel> : (
                        <>
                          <Icon name="trash" size={16} />
                          Confirm delete
                        </>
                      )}
                    </button>
                  </footer>
                </section>
              )}
              {!reviewingDeletion && (visibleSelection.length > 0 || draggedId) && (
                <footer
                  className="account-delete-area"
                  data-dragging={draggedId ? "" : undefined}
                  data-account-drop="delete"
                  data-drop-active={dropTarget === "delete" ? "" : undefined}
                >
                  {draggedId && <DeleteDropDots />}
                  <DeleteAccountsButton
                    count={visibleSelection.length}
                    dragging={!!draggedId}
                    dropActive={dropTarget === "delete"}
                    disabled={busy || editing || !!draggedId || !visibleSelection.length}
                    onClick={() => reviewDeletion(visibleSelection.map(({ id }) => id))}
                  />
                </footer>
              )}
            </section>
            <section ref={detailPane} className="detail-pane" aria-label="Account details">
              {error && (
                <p className="error-banner" role="alert">
                  {error}
                </p>
              )}
              {unlockSettings ? (
                <section
                  className="detail-page"
                  aria-labelledby="quick-unlock-heading"
                >
                  <div className="detail-heading">
                    <h2 id="quick-unlock-heading" tabIndex={-1}>
                      Settings
                    </h2>
                    <button
                      className="secondary"
                      onClick={() => {
                        setUnlockSettings(false);
                        setError("");
                      }}
                    >
                      Done
                    </button>
                  </div>
                  <div className="detail-section">
                    <h3>Touch ID</h3>
                    <p>
                      {status.touchIdEnabled
                        ? "On for this Mac."
                        : status.touchIdAvailable
                          ? "Store your passphrase in this Mac’s Keychain, protected by Touch ID."
                          : "Set up Touch ID in System Settings and reopen MailPort."}
                    </p>
                    <button
                      className="secondary"
                      disabled={
                        busy ||
                        (!status.touchIdAvailable && !status.touchIdEnabled)
                      }
                      onClick={() =>
                        void configureQuickUnlock(
                          "touchId",
                          !status.touchIdEnabled,
                        )
                      }
                    >
                      {status.touchIdEnabled
                        ? "Turn off Touch ID"
                        : "Turn on Touch ID"}
                    </button>
                  </div>
                  <div className="detail-section">
                    <h3>1Password</h3>
                    {status.onePasswordEnabled ? (
                      <>
                        <p>Connected to a password field in 1Password.</p>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            void configureQuickUnlock("onePassword", false)
                          }
                        >
                          Disconnect 1Password
                        </button>
                      </>
                    ) : (
                      <>
                        <p>
                          {status.onePasswordAvailable
                            ? "Enable the CLI integration in 1Password. Copy the secret reference for the field that holds your master passphrase."
                            : "Install the 1Password CLI and turn on its desktop integration."}
                        </p>
                        {status.onePasswordAvailable && (
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              const reference = String(
                                new FormData(event.currentTarget).get(
                                  "reference",
                                ) ?? "",
                              ).trim();
                              void configureQuickUnlock(
                                "onePassword",
                                true,
                                reference,
                              );
                            }}
                          >
                            <Field label="Secret reference">
                              <input
                                name="reference"
                                type="text"
                                placeholder="op://Vault/Item/password"
                                autoComplete="off"
                                spellCheck={false}
                                required
                                maxLength={512}
                                disabled={busy}
                              />
                            </Field>
                            <button
                              className="secondary"
                              disabled={busy}
                              type="submit"
                            >
                              Connect 1Password
                            </button>
                          </form>
                        )}
                      </>
                    )}
                  </div>
                  <details className="detail-section appearance-settings">
                    <summary>Appearance</summary>
                    <div className="appearance-groups">
                      {([
                        [light ? "Light mode buttons" : "Dark mode buttons", buttonStyles],
                        [light ? "Light mode export buttons" : "Dark mode export buttons", exportButtonStyles],
                      ] as const).map(([title, styles]) => (
                        <fieldset className="glass-tint-sliders appearance-button-palette" key={title}>
                          <legend>{title}</legend>
                          {styles.map(([style, label]) => (
                            <div className="appearance-button-color" key={style}>
                              <input
                                type="color"
                                aria-label={`${label} button color`}
                                value={activePalette[style].color}
                                onChange={(event) => updateButtonTint(style, { color: event.currentTarget.value })}
                              />
                              <AppearanceSlider
                                id={`${buttonTheme}-button-${style}`}
                                theme={buttonTheme}
                                label={`${label} tint`}
                                value={activePalette[style].strength}
                                onChange={(strength) => updateButtonTint(style, { strength })}
                              />
                            </div>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                    <div className="appearance-groups">
                      {(["light", "dark"] as const).map((theme) => (
                        <fieldset className="glass-tint-sliders" key={theme}>
                          <legend>{theme === "light" ? "Light mode" : "Dark mode"}</legend>
                          {surfaceControls.map(([surface, label]) => (
                            <AppearanceSlider
                              key={surface}
                              id={`${theme}-${surface}`}
                              theme={theme}
                              label={surface === "modal" ? label : `${label} transparency`}
                              value={transparency[theme][surface]}
                              onChange={(value) => setTransparency((previous) => ({
                                ...previous,
                                [theme]: { ...previous[theme], [surface]: value },
                              }))}
                            />
                          ))}
                        </fieldset>
                      ))}
                    </div>
                  </details>
                </section>
              ) : editor ? (
                <section
                  className="detail-page inline-editor"
                  aria-labelledby="editor-heading"
                  onKeyDown={(event) => {
                    if (
                      event.key === "Escape" &&
                      !event.defaultPrevented &&
                      !busy
                    )
                      setEditor(null);
                  }}
                >
                  <AccountForm
                    key={editor.id}
                    initial={editor}
                    busy={busy}
                    error={modalError}
                    onCancel={() => setEditor(null)}
                    onSave={(account) =>
                      void run(async () => {
                        await invoke("vault_save_account", {
                          account,
                          profileId: activeProfileId ?? null,
                        });
                        setEditor(null);
                        toast.success("Account saved.");
                      }, setModalError)
                    }
                  />
                </section>
              ) : active ? (
                <div className="account-feed">
                  {visibleCards.map((account) => (
                    <AccountDetailCard
                      key={account.id}
                      account={account}
                      profiles={profiles}
                      busy={busy}
                      selected={selected.includes(account.id)}
                      onEdit={() => edit(account.id)}
                      onChooseProfile={(id) => moveAccount(account.id, id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h2>
                    {activeProfile
                      ? "No accounts in this profile"
                      : "No accounts yet"}
                  </h2>
                  <div className="empty-actions">
                    <button
                      id="empty-add-account"
                      className="primary"
                      disabled={busy}
                      onClick={() => edit(undefined, "#empty-add-account")}
                    >
                      Add account
                    </button>
                    {allAccounts.length === 0 && !activeProfile && (
                      <button
                        className="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await invoke("vault_demo");
                            toast.success("Added five sample accounts.");
                          })
                        }
                      >
                        Try sample accounts
                      </button>
                    )}
                  </div>
                </div>
              )}
            </section>
            {hasSelection && (
              <aside
                className="export-sidebar"
                data-transfer-open={!exportCollapsed && transfer ? "" : undefined}
                aria-labelledby="export-heading"
              >
                <div className="export-toolbar">
                  <h2
                    id="export-heading"
                    className={exportCollapsed ? "sr-only" : undefined}
                  >
                    Selected accounts
                  </h2>
                  <button
                    type="button"
                    className="icon-button export-toggle"
                    aria-expanded={!exportCollapsed}
                    aria-label={
                      exportCollapsed
                        ? "Expand selected accounts"
                        : "Collapse selected accounts"
                    }
                    title={
                      exportCollapsed
                        ? "Expand selected accounts"
                        : "Collapse selected accounts"
                    }
                    disabled={busy}
                    onClick={() => {
                      if (exportCollapsed && transfer) {
                        openTransfer();
                      } else {
                        setExportCollapsed(!exportCollapsed);
                      }
                    }}
                  >
                    <Icon name="sidebar" size={16} />
                  </button>
                </div>
                {!exportCollapsed && (
                  <div className="export-selection">
                    {exportGroups.map((group) => (
                      <section key={group.id}>
                        {hasProfileGroups && <h3>{group.name}</h3>}
                        <ul>
                          {group.accounts.map((account) => (
                            <li key={account.id}>{account.email}</li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                {!exportCollapsed && (
                  <div className="export-package">
                    <img
                      ref={transferDocument}
                      className="export-package-icon"
                      src="/mailport-document.png"
                      alt=""
                      width={96}
                      height={96}
                      draggable={false}
                    />
                    <p className="export-package-type">
                      Encrypted <code>.mailport</code> package
                    </p>
                  </div>
                )}
                {!exportCollapsed && transfer ? (
                  <section className="transfer-panel" aria-labelledby="export-stage-heading">
                    <div className="transfer-content">
                      <h3 id="export-stage-heading" tabIndex={-1}>
                        {transfer.stage === "saved" ? "Export saved" : "Send to an email app"}
                      </h3>
                      {transfer.stage === "request" && (
                        <ol className="transfer-steps">
                          <li>In your email app, choose <strong>Import from MailPort</strong>.</li>
                          <li>Click <strong>Open import file</strong> and choose the <code>.mailport-request</code> file your email app created.</li>
                          <li>Compare the codes in both apps. If they match, click <strong>Codes match · Save</strong>.</li>
                        </ol>
                      )}
                      {transfer.stage === "review" && (
                        <>
                          <p>Does this code match the one in <strong>{transfer.recipient.clientName}</strong>?</p>
                          <code className="transfer-code">{transfer.recipient.verificationCode}</code>
                          <small>Your email app can keep the credentials you share.</small>
                          <button
                            id="transfer-choose-request"
                            type="button"
                            className="secondary"
                            disabled={busy || editing}
                            onClick={chooseImportRequest}
                          >
                            {transferAction === "choose" ? <LoadingLabel>Opening…</LoadingLabel> : "Change file"}
                          </button>
                        </>
                      )}
                      {transfer.stage === "saved" && (
                        <>
                          <p className="transfer-location">
                            <span ref={transferFolder}><Icon name="folder" size={16} /></span>
                            <span>
                              {transfer.folderName ? <>Saved <strong>{transfer.fileName}</strong> to <strong>{transfer.folderName}</strong></> : <>Saved <strong>{transfer.fileName}</strong></>}
                            </span>
                          </p>
                          <p>Open <strong>{transfer.fileName}</strong> in your email app and check that this code matches.</p>
                          <code className="transfer-code">{transfer.code}</code>
                        </>
                      )}
                      {transferError && <p className="transfer-error" role="alert">{transferError}</p>}
                    </div>
                    <footer className="export-footer transfer-actions">
                      {transfer.stage === "request" && (
                        <button
                          id="transfer-choose-request"
                          className="primary export-action"
                          type="button"
                          disabled={busy || editing}
                          onClick={chooseImportRequest}
                        >
                          {transferAction === "choose" ? <LoadingLabel>Opening…</LoadingLabel> : "Open import file"}
                        </button>
                      )}
                      {transfer.stage === "review" && (
                        <button
                          id="transfer-approve"
                          className="primary"
                          type="button"
                          disabled={busy || editing}
                          onClick={saveTransfer}
                        >
                          {transferAction === "save" ? <LoadingLabel>Preparing…</LoadingLabel> : "Codes match · Save"}
                        </button>
                      )}
                      {transfer.stage === "saved" ? (
                        <button type="button" className="primary" onClick={closeTransfer}>Done</button>
                      ) : (
                        <button
                          type="button"
                          className="icon-button transfer-cancel"
                          aria-label="Cancel transfer"
                          title="Cancel transfer"
                          disabled={busy}
                          onClick={closeTransfer}
                        >
                          <Icon name="close" size={16} />
                          <span className="transfer-cancel-label" aria-hidden="true">
                            <Icon name="close" size={16} />
                            Cancel transfer
                          </span>
                        </button>
                      )}
                    </footer>
                  </section>
                ) : (
                  <footer className="export-footer">
                    <button
                      id="export-accounts"
                      data-control-glass
                      className={`export-action ${exportCollapsed ? "icon-button" : "secondary"}`}
                      aria-label={
                        exportCollapsed
                          ? transfer ? "Show transfer" : `Export ${selectedAccounts.length} selected accounts`
                          : undefined
                      }
                      title={
                        exportCollapsed
                          ? transfer ? "Show transfer" : `Export ${selectedAccounts.length} selected accounts`
                          : undefined
                      }
                      disabled={busy || editing}
                      onClick={openTransfer}
                    >
                      <Icon name="export" size={16} />
                      {!exportCollapsed && (
                        <>
                          Export
                          <span className="selection-count">{selectedAccounts.length}</span>
                        </>
                      )}
                    </button>
                  </footer>
                )}
              </aside>
            )}
          </>
        )}
      </main>
      {carried && (
        <div ref={paintCard} className="account-drag-card" aria-hidden="true">
          <Icon name="mail" size={18} />
          <span>
            <strong>{carried.displayName || carried.email}</strong>
            {targetProfile && <small>Drop into {targetProfile.name}</small>}
            {dropTarget === "delete" && <small>Review deletion</small>}
          </span>
        </div>
      )}
      {profileEditor && (
        <Modal
          title={profileEditor.id ? "Edit profile" : "Add profile"}
          className="profile-dialog"
          onClose={() => {
            if (!busy) setProfileEditor(null);
          }}
        >
          <ProfileForm
            initial={profileEditor}
            busy={busy}
            error={modalError}
            onCancel={() => setProfileEditor(null)}
            onSave={(profile) =>
              void run(async () => {
                await invoke("vault_save_profile", { profile });
                setProfileEditor(null);
              }, setModalError)
            }
          />
        </Modal>
      )}
      <Toaster
        position="bottom-center"
        theme={light ? "light" : "dark"}
        offset={24}
        visibleToasts={2}
        containerAriaLabel="MailPort notifications"
        toastOptions={{ unstyled: true, className: "vault-toast" }}
      />
    </div>
  );
}
