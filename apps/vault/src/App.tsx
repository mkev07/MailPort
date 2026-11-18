import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  activateWindowAppearance,
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
  incomingHost: string;
  outgoingHost: string;
  requiresSignIn: boolean;
};
type Status = { exists: boolean; unlocked: boolean; accounts: Summary[] };
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
    | "close"
    | "export"
    | "edit";
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
    shield: (
      <>
        <path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-5" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    export: (
      <>
        <path d="M12 15V3m-4 4 4-4 4 4M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5" />
      </>
    ),
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
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">
        <Icon name="mail" size={25} />
      </span>
      <span>
        MailPort<span className="brand-sub">VAULT</span>
      </span>
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
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
      className="vault-dialog"
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
function PasswordFields({ creating }: { creating: boolean }) {
  return (
    <>
      <Field label={creating ? "Master passphrase" : "Master passphrase"}>
        <input
          autoFocus
          name="password"
          type="password"
          autoComplete={creating ? "new-password" : "current-password"}
          required
          minLength={12}
          placeholder="Enter your passphrase"
        />
      </Field>
      {creating && (
        <Field label="Confirm master passphrase">
          <input
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            placeholder="Enter it again"
          />
        </Field>
      )}
    </>
  );
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
function ServerFields({
  title,
  server,
  editing,
  onChange,
}: {
  title: string;
  server: Server;
  editing: boolean;
  onChange: (s: Server) => void;
}) {
  return (
    <fieldset className="server-fields">
      <legend>{title}</legend>
      <div className="form-grid">
        <Field label="Server hostname">
          <input
            value={server.host}
            onChange={(e) => onChange({ ...server, host: e.target.value })}
            required
            placeholder={
              title === "Incoming · IMAP"
                ? "imap.example.com"
                : "smtp.example.com"
            }
          />
        </Field>
        <Field label="Port">
          <input
            type="number"
            min={1}
            max={65535}
            required
            value={server.port}
            onChange={(e) =>
              onChange({ ...server, port: Number(e.target.value) })
            }
          />
        </Field>
        <Field label="Username">
          <input
            value={server.username}
            onChange={(e) => onChange({ ...server, username: e.target.value })}
            required
            autoComplete="off"
          />
        </Field>
        <Field label="Connection security">
          <select
            value={server.security}
            onChange={(e) =>
              onChange({
                ...server,
                security: e.target.value as Server["security"],
              })
            }
          >
            <option value="tls">TLS</option>
            <option value="starttls">STARTTLS (required)</option>
          </select>
        </Field>
      </div>
      <Field label="Authentication">
        <select
          value={server.auth.type}
          onChange={(e) =>
            onChange({
              ...server,
              auth:
                e.target.value === "oauth"
                  ? { type: "oauth", providerId: "" }
                  : { type: "password", password: "" },
            })
          }
        >
          <option value="password">Password or app password</option>
          <option value="oauth">OAuth · sign in in the email client</option>
        </select>
      </Field>
      {server.auth.type === "password" ? (
        <Field
          label="Password or app password"
          hint={
            editing
              ? "Leave blank to keep the saved password for this server."
              : undefined
          }
        >
          <input
            type="password"
            autoComplete="new-password"
            value={server.auth.password}
            required={!editing}
            onChange={(e) =>
              onChange({
                ...server,
                auth: { type: "password", password: e.target.value },
              })
            }
          />
        </Field>
      ) : (
        <Field
          label="Provider identifier"
          hint="For example: google or microsoft. No OAuth tokens are stored."
        >
          <input
            value={server.auth.providerId}
            required
            maxLength={128}
            onChange={(e) =>
              onChange({
                ...server,
                auth: { type: "oauth", providerId: e.target.value },
              })
            }
          />
        </Field>
      )}
    </fieldset>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState<Account | null>(null);
  const [exporting, setExporting] = useState(false);
  const [modalError, setModalError] = useState("");
  const returnFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!busy && !editor && !exporting && returnFocus.current) {
      document.querySelector<HTMLElement>(returnFocus.current)?.focus();
      returnFocus.current = null;
    }
  }, [busy, editor, exporting]);
  const statusRef = useRef(status);
  statusRef.current = status;
  const refresh = async () => {
    const next = await invoke<Status>("vault_status");
    setStatus(next);
    if (!next.unlocked) {
      setSelected([]);
      setEditor(null);
      setExporting(false);
      setModalError("");
    }
  };
  useEffect(() => {
    saveInsetLayout(false);
    saveBodyGlass(true);
    document.documentElement.classList.add("glass-body");
    requestAnimationFrame(() => activateWindowAppearance());
    void refresh().catch(() =>
      setError(
        "MailPort could not reach its local vault. Open the desktop application to continue.",
      ),
    );
    const timer = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 2000);
    let touched = 0;
    const touch = () => {
      if (statusRef.current?.unlocked && Date.now() - touched > 15000) {
        touched = Date.now();
        void invoke("vault_touch").catch(() => {});
      }
    };
    document.addEventListener("pointerdown", touch);
    document.addEventListener("keydown", touch);
    return () => {
      clearInterval(timer);
      document.removeEventListener("pointerdown", touch);
      document.removeEventListener("keydown", touch);
    };
  }, []);
  const run = async (operation: () => Promise<void>, modal = false) => {
    setBusy(true);
    setError("");
    setModalError("");
    setNotice("");
    try {
      await operation();
      await refresh();
    } catch (e) {
      const message =
        typeof e === "string"
          ? e
          : "The operation could not finish. Try again.";
      if (modal) setModalError(message);
      else setError(message);
    } finally {
      setBusy(false);
    }
  };
  const unlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password"));
    if (!status?.exists && password !== fields.get("confirm")) {
      setError("The passphrases do not match. Enter them again.");
      form.querySelector<HTMLInputElement>('[name="confirm"]')?.focus();
      return;
    }
    form.reset();
    void run(async () => {
      await invoke(status?.exists ? "vault_unlock" : "vault_create", {
        password,
      });
    });
  };
  const lock = () => {
    setEditor(null);
    setExporting(false);
    setSelected([]);
    void run(async () => {
      await invoke("vault_lock");
    });
  };
  const edit = (id?: string) => {
    returnFocus.current = id ? `[data-edit-id="${id}"]` : "#add-account";
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
  const exportSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const password = String(fields.get("password"));
    if (password !== fields.get("confirm")) {
      setModalError("The export passwords do not match.");
      form.querySelector<HTMLInputElement>('[name="confirm"]')?.focus();
      return;
    }
    form.reset();
    void run(async () => {
      const saved = await invoke<boolean>("vault_export", {
        ids: selected,
        password,
      });
      setExporting(false);
      if (saved)
        setNotice(
          "Encrypted package saved. Share its password through a separate secure channel.",
        );
    }, true);
  };
  return (
    <div className="vault-app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="drag-strip" data-tauri-drag-region>
        <span className="window-title">MailPort Vault</span>
        <span className="preview-tag">DEVELOPER PREVIEW</span>
      </div>
      <div className="vault-layout">
        <aside className="vault-sidebar">
          <Brand />
          <div className="sidebar-section">WORKSPACE</div>
          <div className="sidebar-current">
            <Icon name="mail" />
            <span>My accounts</span>
            {status?.unlocked && (
              <span className="count-pill">{status.accounts.length}</span>
            )}
          </div>
          <div className="sidebar-note">
            <span className="tiny-line" />
            Set up once.
            <br />
            Bring your accounts
            <br />
            with you.
          </div>
          <div className="sidebar-bottom">
            <div>
              <Icon name="shield" size={17} />
              <span>Stored on this device</span>
            </div>
            <p>
              No MailPort account.
              <br />
              No cloud required.
            </p>
            {status?.unlocked && (
              <button
                className="secondary lock-button"
                onClick={lock}
                disabled={busy}
              >
                <Icon name="lock" size={16} />
                Lock vault
              </button>
            )}
          </div>
        </aside>
        <main id="main-content" className="vault-main" tabIndex={-1}>
          <div className="live-message" role="status">
            {notice}
          </div>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
          {!status ? (
            <div className="loading-state">
              <Icon name="lock" size={32} />
              <p>Opening your local vault…</p>
            </div>
          ) : !status.unlocked ? (
            <div className="welcome">
              <div className="welcome-emblem">
                <Icon name="lock" size={32} />
              </div>
              <div className="eyebrow">YOUR ACCOUNTS. YOUR KEYS.</div>
              <h1>
                {status.exists
                  ? "Welcome back."
                  : "Every account.\nOne safe place."}
              </h1>
              <p className="welcome-description">
                {status.exists
                  ? "Unlock your vault to manage your accounts and choose what to bring with you."
                  : "Keep your email settings together. Choose the accounts you want to bring to your next email client."}
              </p>
              <form className="unlock-form" onSubmit={unlock}>
                <fieldset disabled={busy}>
                  <PasswordFields creating={!status.exists} />
                  {!status.exists && (
                    <p className="password-note">
                      Use a strong, unique passphrase of at least 12 characters.
                      MailPort cannot recover it for you.
                    </p>
                  )}
                  <button className="primary wide" type="submit">
                    {busy
                      ? "Opening vault…"
                      : status.exists
                        ? "Unlock vault"
                        : "Create my vault"}
                    <Icon name="arrow" size={18} />
                  </button>
                </fieldset>
              </form>
              <div className="welcome-foot">
                <Icon name="shield" size={15} />
                <span>Encrypted on your device. No server involved.</span>
              </div>
              <p className="prototype-note">
                Early prototype · Use synthetic accounts while security review
                is pending.
              </p>
            </div>
          ) : (
            <>
              <header className="accounts-heading">
                <div>
                  <div className="eyebrow">YOUR PERSONAL VAULT</div>
                  <h1>
                    My accounts<span className="heading-dot">.</span>
                  </h1>
                  <p>A home for every inbox. Ready for your next move.</p>
                </div>
                <button
                  id="add-account"
                  className="primary"
                  onClick={() => edit()}
                  disabled={busy}
                >
                  <Icon name="plus" size={17} />
                  Add account
                </button>
              </header>
              <section className="account-section" aria-label="Email accounts">
                <div className="account-toolbar">
                  <label className="select-all">
                    <input
                      type="checkbox"
                      checked={
                        status.accounts.length > 0 &&
                        selected.length === status.accounts.length
                      }
                      disabled={status.accounts.length === 0 || busy}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? status.accounts.map((a) => a.id)
                            : [],
                        )
                      }
                    />
                    <span>
                      {selected.length
                        ? `${selected.length} selected`
                        : `${status.accounts.length} accounts`}
                    </span>
                  </label>
                  <button
                    id="export-accounts"
                    className="secondary export-button"
                    disabled={selected.length === 0 || busy}
                    onClick={() => {
                      setModalError("");
                      returnFocus.current = "#export-accounts";
                      setExporting(true);
                    }}
                  >
                    <Icon name="export" size={16} />
                    Export selected
                  </button>
                </div>
                {status.accounts.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-icon">
                      <Icon name="mail" size={32} />
                    </span>
                    <h2>Your accounts, together.</h2>
                    <p>
                      Add your first account, or explore MailPort
                      <br />
                      with five clearly labeled sample accounts.
                    </p>
                    <button
                      className="secondary"
                      onClick={() =>
                        void run(async () => {
                          await invoke("vault_demo");
                          setNotice(
                            "Five synthetic accounts added. These are not real mailboxes.",
                          );
                        })
                      }
                      disabled={busy}
                    >
                      Try five sample accounts
                      <Icon name="arrow" size={16} />
                    </button>
                  </div>
                ) : (
                  <ul className="account-list">
                    {status.accounts.map((account, index) => (
                      <li
                        key={account.id}
                        className={
                          selected.includes(account.id) ? "selected" : ""
                        }
                      >
                        <label className="account-pick">
                          <input
                            type="checkbox"
                            aria-label={`Select ${account.email}`}
                            checked={selected.includes(account.id)}
                            disabled={busy}
                            onChange={() => toggle(account.id)}
                          />
                          <span
                            className={`account-monogram color-${index % 4}`}
                            aria-hidden="true"
                          >
                            {(account.displayName || account.email)
                              .slice(0, 1)
                              .toUpperCase()}
                          </span>
                          <span className="account-identity">
                            <strong>
                              {account.displayName || account.email}
                            </strong>
                            <span>{account.email}</span>
                          </span>
                        </label>
                        <span className="account-server">
                          {account.incomingHost}
                          <small>IMAP + SMTP</small>
                        </span>
                        <span
                          className={`auth-badge ${account.requiresSignIn ? "oauth" : ""}`}
                        >
                          {account.requiresSignIn
                            ? "Sign-in required"
                            : "Password saved"}
                        </span>
                        <button
                          className="icon-button"
                          data-edit-id={account.id}
                          aria-label={`Edit ${account.email}`}
                          disabled={busy}
                          onClick={() => edit(account.id)}
                        >
                          <Icon name="edit" size={17} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className="portability-note">
                <span className="note-icon">
                  <Icon name="export" size={21} />
                </span>
                <div>
                  <h2>Take only what you choose.</h2>
                  <p>
                    Export selected accounts into a password-protected package.
                    <br />
                    Compatible clients can import it. OAuth accounts still need
                    sign-in.
                  </p>
                </div>
              </section>
              <footer className="vault-footer">
                <span>
                  <Icon name="shield" size={15} />
                  Local, encrypted storage
                </span>
                <span>
                  <Icon name="lock" size={14} />
                  Locks after 5 minutes of inactivity
                </span>
              </footer>
              <p className="prototype-note">
                Developer preview · Connection checks and real email-client
                integrations are not available yet.
              </p>
            </>
          )}
        </main>
      </div>
      {editor && (
        <Modal
          title={editor.id ? "Edit email account" : "Add email account"}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setModalError("");
            }
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await invoke("vault_save_account", { account: editor });
                setEditor(null);
                setNotice("Account saved in your encrypted vault.");
              }, true);
            }}
          >
            <fieldset disabled={busy}>
              <p className="dialog-description">
                Store connection settings here. MailPort does not sign in to or
                read your mailbox.
              </p>
              <div className="form-grid">
                <Field label="Email address">
                  <input
                    autoFocus
                    type="email"
                    required
                    value={editor.email}
                    onChange={(e) => {
                      const email = e.target.value;
                      setEditor({
                        ...editor,
                        email,
                        incoming: {
                          ...editor.incoming,
                          username:
                            editor.incoming.username === editor.email
                              ? email
                              : editor.incoming.username,
                        },
                        outgoing: {
                          ...editor.outgoing,
                          username:
                            editor.outgoing.username === editor.email
                              ? email
                              : editor.outgoing.username,
                        },
                      });
                    }}
                  />
                </Field>
                <Field label="Display name">
                  <input
                    value={editor.displayName}
                    maxLength={256}
                    onChange={(e) =>
                      setEditor({ ...editor, displayName: e.target.value })
                    }
                  />
                </Field>
              </div>
              <ServerFields
                title="Incoming · IMAP"
                server={editor.incoming}
                editing={!!editor.id}
                onChange={(incoming) => setEditor({ ...editor, incoming })}
              />
              <ServerFields
                title="Outgoing · SMTP"
                server={editor.outgoing}
                editing={!!editor.id}
                onChange={(outgoing) => setEditor({ ...editor, outgoing })}
              />
              {modalError && (
                <p className="error-banner" role="alert">
                  {modalError}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditor(null)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit">
                  {busy ? "Saving…" : "Save account"}
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {exporting && (
        <Modal
          title="Bring your accounts with you"
          onClose={() => {
            if (!busy) {
              setExporting(false);
              setModalError("");
            }
          }}
        >
          <form onSubmit={exportSubmit}>
            <fieldset disabled={busy}>
              <p className="dialog-description">
                Only these {selected.length} selected{" "}
                {selected.length === 1 ? "account" : "accounts"} will be
                included.
              </p>
              <ul className="export-accounts">
                {status?.accounts
                  .filter((a) => selected.includes(a.id))
                  .map((a) => (
                    <li key={a.id}>
                      <Icon name="mail" size={17} />
                      <span>
                        {a.email}
                        {a.requiresSignIn && (
                          <small>
                            Sign-in required in the receiving client
                          </small>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
              <div className="disclosure">
                <Icon name="shield" size={20} />
                <p>
                  Anyone with this package and its password can read and keep
                  the included credentials. Vault permissions cannot retract
                  their copy.
                </p>
              </div>
              <Field
                label="Export password"
                hint="At least 12 characters. Use a different password from your master passphrase."
              >
                <input
                  autoFocus
                  type="password"
                  name="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
              </Field>
              <Field label="Confirm export password">
                <input
                  type="password"
                  name="confirm"
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
              </Field>
              {modalError && (
                <p className="error-banner" role="alert">
                  {modalError}
                </p>
              )}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setExporting(false)}
                >
                  Cancel
                </button>
                <button className="primary" type="submit">
                  {busy ? "Preparing package…" : "Choose where to save"}
                  <Icon name="export" size={16} />
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
    </div>
  );
}
