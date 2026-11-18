use mailport_core::{Account, Auth};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
const IDLE_LIMIT: Duration = Duration::from_secs(5 * 60);
pub struct Session {
    accounts: Vec<Account>,
    password: Zeroizing<String>,
    touched: Instant,
}
pub struct VaultState {
    pub path: PathBuf,
    pub session: Mutex<Option<Session>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    id: String,
    email: String,
    display_name: String,
    incoming_host: String,
    outgoing_host: String,
    requires_sign_in: bool,
}
#[derive(Serialize)]
pub struct Status {
    exists: bool,
    unlocked: bool,
    accounts: Vec<Summary>,
}
fn summaries(accounts: &[Account]) -> Vec<Summary> {
    accounts
        .iter()
        .map(|a| Summary {
            id: a.id.clone(),
            email: a.email.clone(),
            display_name: a.display_name.clone(),
            incoming_host: a.incoming.host.clone(),
            outgoing_host: a.outgoing.host.clone(),
            requires_sign_in: matches!(a.incoming.auth, Auth::Oauth { .. })
                || matches!(a.outgoing.auth, Auth::Oauth { .. }),
        })
        .collect()
}
fn expire(session: &mut Option<Session>) {
    if session
        .as_ref()
        .is_some_and(|s| s.touched.elapsed() >= IDLE_LIMIT)
    {
        *session = None;
    }
}
fn with_session<T>(
    app: &AppHandle,
    f: impl FnOnce(&mut Session, &PathBuf) -> Result<T>,
) -> Result<T> {
    let state = app.state::<VaultState>();
    let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut guard);
    let session = guard
        .as_mut()
        .ok_or("Your vault is locked. Unlock it to continue.")?;
    session.touched = Instant::now();
    f(session, &state.path)
}
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| "The operation could not finish. Try again.".to_owned())?
}
#[tauri::command]
pub fn vault_status(state: tauri::State<VaultState>) -> Result<Status> {
    let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut session);
    Ok(Status {
        exists: state.path.exists(),
        unlocked: session.is_some(),
        accounts: session
            .as_ref()
            .map(|s| summaries(&s.accounts))
            .unwrap_or_default(),
    })
}
#[tauri::command]
pub async fn vault_create(app: AppHandle, password: String) -> Result<()> {
    let password = Zeroizing::new(password);
    blocking(move || {
        let state = app.state::<VaultState>();
        let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
        if state.path.exists() {
            return Err("A vault already exists. Unlock it instead.".into());
        }
        let encrypted = mailport_core::seal(&[], &password)?;
        mailport_core::write_new_encrypted(&state.path, &encrypted)?;
        *guard = Some(Session {
            accounts: vec![],
            password,
            touched: Instant::now(),
        });
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn vault_unlock(app: AppHandle, password: String) -> Result<()> {
    let password = Zeroizing::new(password);
    blocking(move || {
        let state = app.state::<VaultState>();
        let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
        let accounts =
            mailport_core::unlock(&mailport_core::read_encrypted(&state.path)?, &password)?;
        *guard = Some(Session {
            accounts,
            password,
            touched: Instant::now(),
        });
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn vault_lock(state: tauri::State<VaultState>) -> Result<()> {
    *state.session.lock().map_err(|_| "Vault is unavailable.")? = None;
    Ok(())
}
#[tauri::command]
pub fn vault_account(app: AppHandle, id: String) -> Result<Account> {
    with_session(&app, |session, _| {
        let mut account = session
            .accounts
            .iter()
            .find(|a| a.id == id)
            .ok_or("Account not found.")?
            .clone();
        for auth in [&mut account.incoming.auth, &mut account.outgoing.auth] {
            if let Auth::Password { password } = auth {
                use zeroize::Zeroize;
                password.zeroize();
                password.clear();
            }
        }
        Ok(account)
    })
}
#[tauri::command]
pub async fn vault_save_account(app: AppHandle, mut account: Account) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            if account.id.is_empty() {
                account.id = uuid::Uuid::new_v4().to_string();
            }
            let mut accounts = session.accounts.clone();
            if let Some(old) = accounts.iter_mut().find(|a| a.id == account.id) {
                for (new, existing) in [
                    (&mut account.incoming.auth, &old.incoming.auth),
                    (&mut account.outgoing.auth, &old.outgoing.auth),
                ] {
                    if let (Auth::Password { password }, Auth::Password { password: previous }) =
                        (new, existing)
                    {
                        if password.is_empty() {
                            *password = previous.clone();
                        }
                    }
                }
                *old = account.clone();
            } else {
                accounts.push(account.clone());
            }
            let encrypted = mailport_core::seal(&accounts, &session.password)?;
            mailport_core::write_encrypted(path, &encrypted)?;
            session.accounts = accounts;
            Ok(())
        })
    })
    .await
}
#[tauri::command]
pub async fn vault_export(app: AppHandle, ids: Vec<String>, password: String) -> Result<bool> {
    let password = Zeroizing::new(password);
    blocking(move || {
        let encrypted = with_session(&app, |session, _| {
            if password.as_str() == session.password.as_str() {
                return Err("Use a different password from your master passphrase.".into());
            }
            let selected = mailport_core::select_accounts(&session.accounts, &ids)?;
            Ok(mailport_core::seal(&selected, &password)?)
        })?;
        let path = app
            .dialog()
            .file()
            .set_title("Export selected MailPort accounts")
            .set_file_name("MailPort-accounts.mailport")
            .add_filter("Encrypted MailPort package", &["mailport"])
            .blocking_save_file();
        let Some(path) = path else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| "Choose a local file destination.")?;
        // Never let an export replace the master vault, including alias paths.
        let vault_path = app.state::<VaultState>().path.clone();
        if path == vault_path
            || (path.exists() && path.canonicalize().ok() == vault_path.canonicalize().ok())
        {
            return Err("Choose a destination outside the vault's own file.".into());
        }
        mailport_core::write_encrypted(&path, &encrypted)?;
        Ok(true)
    })
    .await
}
#[tauri::command]
pub async fn vault_demo(app: AppHandle) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            if !session.accounts.is_empty() {
                return Err("Sample accounts can only be added to an empty vault.".into());
            }
            let mut accounts = Vec::new();
            for index in 1..=5 {
                let auth = if index == 5 {
                    Auth::Oauth {
                        provider_id: "example-provider".into(),
                    }
                } else {
                    Auth::Password {
                        password: format!("PUBLIC-SYNTHETIC-PASSWORD-{index}"),
                    }
                };
                let server = |host: &str, port, security: &str| mailport_core::Server {
                    host: host.into(),
                    port,
                    security: security.into(),
                    username: format!("sample{index}@example.com"),
                    auth: auth.clone(),
                };
                accounts.push(Account {
                    id: uuid::Uuid::new_v4().to_string(),
                    email: format!("sample{index}@example.com"),
                    display_name: format!("Sample account {index}"),
                    incoming: server("imap.example.com", 993, "tls"),
                    outgoing: server("smtp.example.com", 587, "starttls"),
                });
            }
            mailport_core::write_encrypted(
                path,
                &mailport_core::seal(&accounts, &session.password)?,
            )?;
            session.accounts = accounts;
            Ok(())
        })
    })
    .await
}
pub fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = app.path().app_data_dir()?;
    std::fs::create_dir_all(&directory)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    app.manage(VaultState {
        path: directory.join("vault.mailport"),
        session: Mutex::new(None),
    });
    let handle = app.handle().clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        if let Some(state) = handle.try_state::<VaultState>() {
            if let Ok(mut session) = state.session.lock() {
                expire(&mut session);
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub fn vault_touch(app: AppHandle) -> Result<()> {
    with_session(&app, |_, _| Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn idle_sessions_drop_credentials_and_recent_sessions_remain() {
        let make = |touched| {
            Some(Session {
                accounts: vec![],
                password: Zeroizing::new("synthetic-session-only".into()),
                touched,
            })
        };
        let mut expired = make(Instant::now() - IDLE_LIMIT - Duration::from_secs(1));
        expire(&mut expired);
        assert!(expired.is_none());
        let mut recent = make(Instant::now());
        expire(&mut recent);
        assert!(recent.is_some());
    }
}
