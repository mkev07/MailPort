use crate::{
    profiles::{Profile, Profiles},
    quick_unlock,
};
use mailport_core::{
    transfer::{package_code, ImportRequest},
    Account, Auth,
};
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
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder};
use zeroize::Zeroizing;

type Result<T> = std::result::Result<T, String>;
const IDLE_LIMIT: Duration = Duration::from_secs(5 * 60);
pub struct Session {
    accounts: Vec<Account>,
    profiles: Profiles,
    password: Zeroizing<String>,
    touched: Instant,
    paused_remaining: Option<Duration>,
}
impl Session {
    fn remaining(&self) -> Duration {
        self.paused_remaining
            .unwrap_or_else(|| IDLE_LIMIT.saturating_sub(self.touched.elapsed()))
    }

    fn set_paused(&mut self, paused: bool) {
        if paused && self.paused_remaining.is_none() {
            self.paused_remaining = Some(self.remaining());
        } else if !paused {
            if let Some(remaining) = self.paused_remaining.take() {
                self.touched = Instant::now() - IDLE_LIMIT.saturating_sub(remaining);
            }
        }
    }
}
pub struct VaultState {
    pub path: PathBuf,
    pub session: Mutex<Option<Session>>,
    quick_preferences: Mutex<quick_unlock::Preferences>,
    quick_operation: Mutex<()>,
    touch_id_available: bool,
    lock_generation: AtomicU64,
}
impl VaultState {
    pub(crate) fn lock(&self) -> Result<()> {
        let mut session = self.session.lock().map_err(|_| "Vault is unavailable.")?;
        self.lock_generation.fetch_add(1, Ordering::Relaxed);
        *session = None;
        Ok(())
    }

    fn check_lock_generation(&self, generation: u64) -> Result<()> {
        if generation != self.lock_generation.load(Ordering::Relaxed) {
            return Err("The vault was locked during this operation. Try again.".into());
        }
        Ok(())
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionSummary {
    host: String,
    port: u16,
    security: String,
    username: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    id: String,
    email: String,
    display_name: String,
    incoming: ConnectionSummary,
    outgoing: ConnectionSummary,
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
fn connection(server: &mailport_core::Server) -> ConnectionSummary {
    ConnectionSummary {
        host: server.host.clone(),
        port: server.port,
        security: server.security.clone(),
        username: server.username.clone(),
    }
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
            incoming: connection(&a.incoming),
            outgoing: connection(&a.outgoing),
            requires_sign_in: matches!(a.incoming.auth, Auth::Oauth { .. })
                || matches!(a.outgoing.auth, Auth::Oauth { .. }),
        })
        .collect()
}
fn expire(session: &mut Option<Session>) {
    if session
        .as_ref()
        .is_some_and(|s| s.paused_remaining.is_none() && s.touched.elapsed() >= IDLE_LIMIT)
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
    if session.paused_remaining.is_none() {
        session.touched = Instant::now();
    }
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLockState {
    remaining_seconds: u64,
    paused: bool,
}

fn auto_lock_state(session: &Session) -> AutoLockState {
    AutoLockState {
        remaining_seconds: session.remaining().as_millis().div_ceil(1000) as u64,
        paused: session.paused_remaining.is_some(),
    }
}

#[tauri::command]
pub fn vault_auto_lock_state(state: tauri::State<VaultState>) -> Result<Option<AutoLockState>> {
    let mut session = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut session);
    Ok(session.as_ref().map(auto_lock_state))
}

#[tauri::command]
pub fn vault_set_auto_lock_paused(
    state: tauri::State<VaultState>,
    paused: bool,
) -> Result<AutoLockState> {
    let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
    expire(&mut guard);
    let session = guard
        .as_mut()
        .ok_or("Your vault is locked. Unlock it to continue.")?;
    session.set_paused(paused);
    Ok(auto_lock_state(session))
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
    let generation = app
        .state::<VaultState>()
        .lock_generation
        .load(Ordering::Relaxed);
    blocking(move || {
        let state = app.state::<VaultState>();
        let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
        state.check_lock_generation(generation)?;
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
            paused_remaining: None,
        });
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn vault_unlock(app: AppHandle, password: String) -> Result<()> {
    let password = Zeroizing::new(password);
    let generation = app
        .state::<VaultState>()
        .lock_generation
        .load(Ordering::Relaxed);
    blocking(move || {
        let state = app.state::<VaultState>();
        let mut guard = state.session.lock().map_err(|_| "Vault is unavailable.")?;
        state.check_lock_generation(generation)?;
        let (accounts, profiles) =
            mailport_core::unlock_local(&mailport_core::read_encrypted(&state.path)?, &password)?;
        let (accounts, profiles) =
            remove_legacy_samples(&state.path, &password, accounts, profiles)?;
        *guard = Some(Session {
            accounts,
            profiles,
            password,
            touched: Instant::now(),
            paused_remaining: None,
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
    let generation = app
        .state::<VaultState>()
        .lock_generation
        .load(Ordering::Relaxed);
    blocking(move || {
        let state = app.state::<VaultState>();
        let _operation = state
            .quick_operation
            .try_lock()
            .map_err(|_| "An unlock request is already in progress.")?;
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
        let (accounts, profiles) =
            remove_legacy_samples(&state.path, &password, accounts, profiles)?;
        *session = Some(Session {
            accounts,
            profiles,
            password,
            touched: Instant::now(),
            paused_remaining: None,
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
    state.lock()
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRecipient {
    request_file: String,
    client_name: String,
    verification_code: String,
}

fn transfer_file_dialog(app: &AppHandle) -> FileDialogBuilder<tauri::Wry> {
    let paths = app.path();
    let directory = [paths.download_dir(), paths.document_dir(), paths.home_dir()]
        .into_iter()
        .filter_map(std::result::Result::ok)
        .find(|directory| directory.is_dir());
    let dialog = app.dialog().file();
    match directory {
        Some(directory) => dialog.set_directory(directory),
        None => dialog,
    }
}

#[tauri::command]
pub async fn vault_load_import_request(app: AppHandle) -> Result<Option<ExportRecipient>> {
    blocking(move || {
        with_session(&app, |_, _| Ok(()))?;
        let path = transfer_file_dialog(&app)
            .set_title("Open the .mailport-request file from your email app")
            .add_filter(
                "MailPort import request",
                &["mailport-request", "mailportrequest"],
            )
            .blocking_pick_file();
        let Some(path) = path else {
            return Ok(None);
        };
        let path = path
            .into_path()
            .map_err(|_| "Choose a local request file.")?;
        let (request, request_file) = ImportRequest::read(&path)?;
        with_session(&app, |_, _| {
            Ok(Some(ExportRecipient {
                verification_code: request.verification_code(),
                client_name: request.client_name,
                request_file,
            }))
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedTransfer {
    code: String,
    file_name: String,
    folder_name: Option<String>,
}

#[tauri::command]
pub async fn vault_export(
    app: AppHandle,
    ids: Vec<String>,
    request_file: String,
    verified_code: String,
) -> Result<Option<SavedTransfer>> {
    blocking(move || {
        let request = ImportRequest::parse(&request_file)?;
        if request.verification_code() != verified_code {
            return Err("The import request code does not match.".into());
        }
        let state = app.state::<VaultState>();
        let generation = with_session(&app, |_, _| {
            Ok(state.lock_generation.load(Ordering::Relaxed))
        })?;
        let path = transfer_file_dialog(&app)
            .set_title("Save the .mailport export")
            .set_file_name("MailPort-accounts.mailport")
            .add_filter("Encrypted MailPort package", &["mailport"])
            .blocking_save_file();
        let Some(path) = path else {
            return Ok(None);
        };
        let path = path
            .into_path()
            .map_err(|_| "Choose a local file destination.")?;
        // Never let an export replace the master vault, including alias paths.
        let vault_path = &state.path;
        if path == *vault_path
            || (path.exists() && path.canonicalize().ok() == vault_path.canonicalize().ok())
        {
            return Err("Choose a destination outside the vault's own file.".into());
        }
        quick_unlock::approve_transfer()?;
        with_session(&app, |session, _| {
            if generation != state.lock_generation.load(Ordering::Relaxed) {
                return Err(
                    "The vault was locked during approval. Start the transfer again.".into(),
                );
            }
            let selected = mailport_core::select_accounts(&session.accounts, &ids)?;
            let encrypted = request.seal(&selected)?;
            mailport_core::write_encrypted(&path, &encrypted)?;
            Ok(Some(SavedTransfer {
                code: package_code(&encrypted),
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "MailPort-accounts.mailport".into()),
                folder_name: path
                    .parent()
                    .and_then(|folder| folder.file_name())
                    .map(|name| name.to_string_lossy().into_owned()),
            }))
        })
    })
    .await
}
fn is_legacy_sample(account: &Account) -> bool {
    let Some(index) = account
        .email
        .strip_prefix("sample")
        .and_then(|email| email.strip_suffix("@example.com"))
    else {
        return false;
    };
    if !matches!(index, "1" | "2" | "3" | "4" | "5") {
        return false;
    }
    let matches = |server: &mailport_core::Server, host, port, security| {
        server.host == host
            && server.port == port
            && server.security == security
            && server.username == account.email
            && match &server.auth {
                Auth::Password { password } if index != "5" => {
                    password.strip_prefix("PUBLIC-SYNTHETIC-PASSWORD-") == Some(index)
                }
                Auth::Oauth { provider_id } if index == "5" => provider_id == "example-provider",
                _ => false,
            }
    };
    matches(&account.incoming, "imap.example.com", 993, "tls")
        && matches(&account.outgoing, "smtp.example.com", 587, "starttls")
}

fn remove_legacy_samples(
    path: &std::path::Path,
    password: &str,
    mut accounts: Vec<Account>,
    mut profiles: Profiles,
) -> Result<(Vec<Account>, Profiles)> {
    let before = accounts.len();
    accounts.retain(|account| {
        if is_legacy_sample(account) {
            profiles.assignments.remove(&account.id);
            false
        } else {
            true
        }
    });
    if accounts.len() != before {
        let encrypted = mailport_core::seal_local(&accounts, &profiles, password)?;
        mailport_core::write_encrypted(path, &encrypted)?;
    }
    Ok((accounts, profiles))
}

#[cfg(test)]
#[test]
fn recognizes_legacy_samples_even_if_renamed_and_preserves_other_accounts() {
    let email = "sample1@example.com";
    let server = |host: &str, port, security: &str| mailport_core::Server {
        host: host.into(),
        port,
        security: security.into(),
        username: email.into(),
        auth: Auth::Password {
            password: "PUBLIC-SYNTHETIC-PASSWORD-1".into(),
        },
    };
    let mut account = Account {
        id: "demo".into(),
        email: email.into(),
        display_name: "Renamed demo".into(),
        incoming: server("imap.example.com", 993, "tls"),
        outgoing: server("smtp.example.com", 587, "starttls"),
    };
    assert!(is_legacy_sample(&account));
    account.outgoing.auth = Auth::Password {
        password: "different-test-secret".into(),
    };
    assert!(!is_legacy_sample(&account));
}

#[cfg(target_os = "macos")]
pub(crate) fn direct_account_summaries(app: &AppHandle) -> Vec<(String, String)> {
    let state = app.state::<VaultState>();
    let Ok(mut session) = state.session.lock() else {
        return vec![];
    };
    expire(&mut session);
    session.as_ref().map_or_else(Vec::new, |session| {
        session
            .accounts
            .iter()
            .map(|account| (account.id.clone(), account.email.clone()))
            .collect()
    })
}

#[cfg(target_os = "macos")]
pub(crate) async fn approve_direct_accounts(
    app: AppHandle,
    ids: Vec<String>,
    request: ImportRequest,
) -> Result<String> {
    blocking(move || {
        let state = app.state::<VaultState>();
        let generation = with_session(&app, |session, _| {
            mailport_core::select_accounts(&session.accounts, &ids)?;
            Ok(state.lock_generation.load(Ordering::Relaxed))
        })?;
        quick_unlock::approve_transfer()?;
        with_session(&app, |session, _| {
            state.check_lock_generation(generation)?;
            let selected = mailport_core::select_accounts(&session.accounts, &ids)?;
            request.seal(&selected).map_err(str::to_owned)
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
    fn explicit_lock_clears_a_paused_session_and_invalidates_pending_unlocks() {
        let state = VaultState {
            path: PathBuf::new(),
            session: Mutex::new(Some(Session {
                accounts: vec![],
                profiles: Profiles::default(),
                password: Zeroizing::new("synthetic-session-only".into()),
                touched: Instant::now(),
                paused_remaining: Some(IDLE_LIMIT),
            })),
            quick_preferences: Mutex::new(quick_unlock::Preferences::default()),
            quick_operation: Mutex::new(()),
            touch_id_available: false,
            lock_generation: AtomicU64::new(0),
        };
        state.lock().unwrap();
        assert!(state.session.lock().unwrap().is_none());
        assert!(state.check_lock_generation(0).is_err());
        assert!(state.check_lock_generation(1).is_ok());
    }

    #[test]
    fn idle_sessions_drop_credentials_and_recent_sessions_remain() {
        let make = |touched| {
            Some(Session {
                accounts: vec![],
                profiles: Profiles::default(),
                password: Zeroizing::new("synthetic-session-only".into()),
                touched,
                paused_remaining: None,
            })
        };
        let mut expired = make(Instant::now() - IDLE_LIMIT - Duration::from_secs(1));
        expire(&mut expired);
        assert!(expired.is_none());
        let mut recent = make(Instant::now());
        expire(&mut recent);
        assert!(recent.is_some());
    }

    #[test]
    fn pause_preserves_remaining_time_and_resume_restores_expiry() {
        let mut session = Session {
            accounts: vec![],
            profiles: Profiles::default(),
            password: Zeroizing::new("synthetic-session-only".into()),
            touched: Instant::now() - Duration::from_secs(120),
            paused_remaining: None,
        };
        session.set_paused(true);
        let remaining = session.remaining();
        session.touched = Instant::now() - IDLE_LIMIT - Duration::from_secs(1);
        let mut slot = Some(session);
        expire(&mut slot);
        let session = slot.as_mut().unwrap();
        assert_eq!(session.remaining(), remaining);
        session.set_paused(false);
        assert!(session.remaining() <= remaining);
        assert!(session.remaining() > remaining - Duration::from_secs(1));
        session.touched = Instant::now() - IDLE_LIMIT;
        expire(&mut slot);
        assert!(slot.is_none());
    }
}
