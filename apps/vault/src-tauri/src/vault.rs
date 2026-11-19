use crate::{
    profiles::{Profile, Profiles},
    quick_unlock,
};
use mailport_core::{Account, Auth};
use serde::Serialize;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
const IDLE_LIMIT: Duration = Duration::from_secs(5 * 60);
pub struct Session {
    accounts: Vec<Account>,
    profiles: Profiles,
    password: Zeroizing<String>,
    touched: Instant,
}
pub struct VaultState {
    pub path: PathBuf,
    pub session: Mutex<Option<Session>>,
    quick_preferences: Mutex<quick_unlock::Preferences>,
    quick_operation: Mutex<()>,
    touch_id_available: bool,
    lock_generation: AtomicU64,
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
    profile_id: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    exists: bool,
    unlocked: bool,
    accounts: Vec<Summary>,
    profiles: Vec<Profile>,
    touch_id_available: bool,
    touch_id_enabled: bool,
    one_password_available: bool,
    one_password_enabled: bool,
}
fn summaries(session: &Session) -> Vec<Summary> {
    session
        .accounts
        .iter()
        .map(|a| Summary {
            id: a.id.clone(),
            email: a.email.clone(),
            profile_id: session.profiles.assignments.get(&a.id).cloned(),
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
pub fn vault_session_active(state: tauri::State<VaultState>) -> Result<bool> {
    let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut session);
    Ok(session.is_some())
}

#[tauri::command]
pub fn vault_status(state: tauri::State<VaultState>) -> Result<Status> {
    let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut session);
    let preferences = state
        .quick_preferences
        .lock()
        .map_err(|_| "Unlock settings are unavailable.")?;
    Ok(Status {
        exists: state.path.exists(),
        unlocked: session.is_some(),
        touch_id_available: state.touch_id_available,
        touch_id_enabled: preferences.touch_id,
        one_password_available: quick_unlock::one_password_available(),
        one_password_enabled: preferences.one_password.is_some(),
        profiles: session
            .as_ref()
            .map(|s| s.profiles.items.clone())
            .unwrap_or_default(),
        accounts: session.as_ref().map(summaries).unwrap_or_default(),
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
        let profiles = Profiles::default();
        let encrypted = mailport_core::seal_local(&[], &profiles, &password)?;
        mailport_core::write_new_encrypted(&state.path, &encrypted)?;
        *guard = Some(Session {
            accounts: vec![],
            profiles,
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
        let (accounts, profiles) =
            mailport_core::unlock_local(&mailport_core::read_encrypted(&state.path)?, &password)?;
        *guard = Some(Session {
            accounts,
            profiles,
            password,
            touched: Instant::now(),
        });
        Ok(())
    })
    .await
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuickMethod {
    TouchId,
    OnePassword,
}

#[tauri::command]
pub async fn vault_quick_unlock(app: AppHandle, method: QuickMethod) -> Result<()> {
    blocking(move || {
        let state = app.state::<VaultState>();
        let _operation = state
            .quick_operation
            .try_lock()
            .map_err(|_| "An unlock request is already in progress.")?;
        let generation = state.lock_generation.load(Ordering::Relaxed);
        let (touch_id, reference) = {
            let preferences = state
                .quick_preferences
                .lock()
                .map_err(|_| "Unlock settings are unavailable.")?;
            (preferences.touch_id, preferences.one_password.clone())
        };
        let password = match method {
            QuickMethod::TouchId if touch_id => quick_unlock::read_touch_id()?,
            QuickMethod::OnePassword => quick_unlock::read_one_password(
                reference
                    .as_deref()
                    .ok_or("Set up 1Password unlock first.")?,
            )?,
            _ => return Err("Set up Touch ID unlock first.".into()),
        };
        let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
        if generation != state.lock_generation.load(Ordering::Relaxed) || session.is_some() {
            return Err(
                "The vault changed while you were unlocking it. Try again if it is locked.".into(),
            );
        }
        let (accounts, profiles) =
            mailport_core::unlock_local(&mailport_core::read_encrypted(&state.path)?, &password)
                .map_err(|_| {
                    "The saved passphrase could not unlock this vault. Use your master passphrase."
                })?;
        *session = Some(Session {
            accounts,
            profiles,
            password,
            touched: Instant::now(),
        });
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn vault_configure_quick_unlock(
    app: AppHandle,
    method: QuickMethod,
    enabled: bool,
    reference: Option<String>,
) -> Result<()> {
    blocking(move || {
        let state = app.state::<VaultState>();
        let _operation = state
            .quick_operation
            .try_lock()
            .map_err(|_| "An unlock request is already in progress.")?;
        let generation = state.lock_generation.load(Ordering::Relaxed);
        with_session(&app, |_, _| Ok(()))?;
        let candidate = match (&method, enabled) {
            (QuickMethod::OnePassword, true) => Some(quick_unlock::read_one_password(
                reference
                    .as_deref()
                    .ok_or("Enter a 1Password secret reference.")?,
            )?),
            _ => None,
        };
        with_session(&app, |session, path| {
            if generation != state.lock_generation.load(Ordering::Relaxed) {
                return Err("The vault was locked during setup. Try again.".into());
            }
            let mut preferences = state
                .quick_preferences
                .lock()
                .map_err(|_| "Unlock settings are unavailable.")?;
            let mut next = quick_unlock::Preferences {
                touch_id: preferences.touch_id,
                one_password: preferences.one_password.clone(),
            };
            match (method, enabled) {
                (QuickMethod::TouchId, true) if !preferences.touch_id => {
                    quick_unlock::store_touch_id(&session.password)?;
                    next.touch_id = true;
                    if let Err(error) = quick_unlock::save(path, &next) {
                        quick_unlock::delete_touch_id()?;
                        return Err(error);
                    }
                }
                (QuickMethod::TouchId, true) => return Ok(()),
                (QuickMethod::TouchId, false) => {
                    quick_unlock::delete_touch_id()?;
                    next.touch_id = false;
                    quick_unlock::save(path, &next)?;
                }
                (QuickMethod::OnePassword, true) => {
                    if candidate.as_deref().map(String::as_str) != Some(session.password.as_str()) {
                        return Err(
                            "That 1Password field does not match this vault’s master passphrase."
                                .into(),
                        );
                    }
                    next.one_password = reference;
                    quick_unlock::save(path, &next)?;
                }
                (QuickMethod::OnePassword, false) => {
                    next.one_password = None;
                    quick_unlock::save(path, &next)?;
                }
            }
            *preferences = next;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub fn vault_lock(state: tauri::State<VaultState>) -> Result<()> {
    let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    state.lock_generation.fetch_add(1, Ordering::Relaxed);
    *session = None;
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
pub async fn vault_save_account(
    app: AppHandle,
    mut account: Account,
    profile_id: Option<String>,
) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            let is_new = account.id.is_empty();
            if is_new {
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
            let mut profiles = session.profiles.clone();
            if is_new {
                profiles.assign(account.id.clone(), profile_id)?;
            }
            let encrypted = mailport_core::seal_local(&accounts, &profiles, &session.password)?;
            mailport_core::write_encrypted(path, &encrypted)?;
            session.accounts = accounts;
            session.profiles = profiles;
            Ok(())
        })
    })
    .await
}
fn update_profiles(
    session: &mut Session,
    path: &std::path::Path,
    update: impl FnOnce(&mut Profiles) -> Result<()>,
) -> Result<()> {
    let mut profiles = session.profiles.clone();
    update(&mut profiles)?;
    let encrypted = mailport_core::seal_local(&session.accounts, &profiles, &session.password)?;
    mailport_core::write_encrypted(path, &encrypted)?;
    session.profiles = profiles;
    Ok(())
}

#[tauri::command]
pub async fn vault_save_profile(app: AppHandle, profile: Profile) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            update_profiles(session, path, |profiles| profiles.save(profile))
        })
    })
    .await
}

#[tauri::command]
pub async fn vault_move_account(
    app: AppHandle,
    account_id: String,
    profile_id: Option<String>,
) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            if !session
                .accounts
                .iter()
                .any(|account| account.id == account_id)
            {
                return Err("That account no longer exists.".into());
            }
            update_profiles(session, path, |profiles| {
                profiles.assign(account_id, profile_id)
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn vault_delete_accounts(app: AppHandle, ids: Vec<String>) -> Result<()> {
    blocking(move || {
        with_session(&app, |session, path| {
            mailport_core::select_accounts(&session.accounts, &ids)?;
            let ids: std::collections::HashSet<_> = ids.into_iter().collect();
            let accounts: Vec<_> = session
                .accounts
                .iter()
                .filter(|account| !ids.contains(&account.id))
                .cloned()
                .collect();
            let mut profiles = session.profiles.clone();
            profiles.assignments.retain(|id, _| !ids.contains(id));
            let encrypted = mailport_core::seal_local(&accounts, &profiles, &session.password)?;
            mailport_core::write_encrypted(path, &encrypted)?;
            session.accounts = accounts;
            session.profiles = profiles;
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
                &mailport_core::seal_local(&accounts, &session.profiles, &session.password)?,
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
    let path = directory.join("vault.mailport");
    app.manage(VaultState {
        quick_preferences: Mutex::new(quick_unlock::load(&path)),
        path,
        session: Mutex::new(None),
        quick_operation: Mutex::new(()),
        touch_id_available: quick_unlock::touch_id_available(),
        lock_generation: AtomicU64::new(0),
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
                profiles: Profiles::default(),
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
