use tauri::{
    webview::{NewWindowResponse, WebviewWindowBuilder},
    Manager, Url, WebviewUrl,
};

mod avatar_cache;
#[cfg(target_os = "macos")]
mod direct_import;
mod discovery;
#[cfg(target_os = "macos")]
mod macos;
mod profiles;
mod quick_unlock;
#[cfg(target_os = "macos")]
mod receiver_identity;
mod vault;
#[cfg(target_os = "macos")]
mod vault_lifecycle;
mod window;

const WINDOW_STATE_FILE: &str = ".window-state-v3.json";

fn is_gravatar_editor(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("gravatar.com")
        && url.port().is_none()
        && url.path() == "/profile"
        && url
            .query_pairs()
            .any(|(key, value)| key == "scope" && value == "avatars")
        && url
            .query_pairs()
            .any(|(key, value)| key == "is_quick_editor" && value == "true")
}

fn is_gravatar_navigation(url: &Url) -> bool {
    url.as_str() == "about:blank"
        || (url.scheme() == "https"
            && url.port().is_none()
            && matches!(
                url.host_str(),
                Some(
                    "gravatar.com"
                        | "www.gravatar.com"
                        | "wordpress.com"
                        | "public-api.wordpress.com"
                )
            ))
}

fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
    else {
        return Ok(());
    };
    let handle = app.handle().clone();
    WebviewWindowBuilder::from_config(app, config)?
        .on_new_window(move |url, features| {
            if !is_gravatar_editor(&url) || handle.get_webview_window("gravatar-editor").is_some() {
                return NewWindowResponse::Deny;
            }
            let window = WebviewWindowBuilder::new(
                &handle,
                "gravatar-editor",
                WebviewUrl::External("about:blank".parse().expect("valid blank URL")),
            )
            .window_features(features)
            .title("Edit Gravatar photo")
            .on_navigation(is_gravatar_navigation)
            .on_new_window(|_, _| NewWindowResponse::Deny)
            .build();
            match window {
                Ok(window) => NewWindowResponse::Create { window },
                Err(_) => NewWindowResponse::Deny,
            }
        })
        .build()?;
    Ok(())
}

fn fit_first_launch_window(app: &tauri::App) {
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    if config_dir.join(WINDOW_STATE_FILE).exists() {
        return;
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
    else {
        return;
    };
    let area = monitor
        .work_area()
        .size
        .to_logical::<f64>(monitor.scale_factor());
    let previous_size = std::fs::read(config_dir.join(".window-state.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|state| {
            let width = state["main"]["width"].as_u64()?;
            let height = state["main"]["height"].as_u64()?;
            (width > 0 && height > 0).then_some((width, height))
        });
    let (width, height) = previous_size.map_or((1500.0, 1020.0), |(width, height)| {
        let scale = 2.0 / monitor.scale_factor();
        (width as f64 * scale, height as f64 * scale)
    });
    let scale = ((area.width - 32.0).max(1.0) / width)
        .min((area.height - 48.0).max(1.0) / height)
        .min(1.0);
    let _ = window.set_size(tauri::LogicalSize::new(width * scale, height * scale));
    let _ = window.center();
}

pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        let version = context.package_info().version.to_string();
        let bundle_version = context
            .config()
            .bundle
            .macos
            .bundle_version
            .as_deref()
            .unwrap_or(&version);
        macos::ensure_dev_bundle(&version, bundle_version);
    }
    #[cfg(target_os = "macos")]
    macos::register_spellcheck_default();

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filename(WINDOW_STATE_FILE)
                .build(),
        )
        .setup(|app| {
            vault::setup(app)?;
            app.manage(avatar_cache::AvatarCache::default());
            create_main_window(app)?;
            #[cfg(target_os = "macos")]
            {
                app.manage(direct_import::DirectImport::default());
                if let Err(error) = direct_import::start(app.handle()) {
                    eprintln!("mailport: direct import is unavailable: {}", error.kind());
                }
            }
            #[cfg(target_os = "macos")]
            vault_lifecycle::install(app.handle().clone());
            fit_first_launch_window(app);
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                macos::install(&window);
            }
            #[cfg(not(target_os = "macos"))]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_decorations(false);
                let _ = window.set_shadow(true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            avatar_cache::vault_avatar,
            avatar_cache::vault_cache_size,
            avatar_cache::vault_clear_cache,
            window::set_window_glass_enabled,
            window::set_vault_control_glass,
            window::system_accent_color,
            vault::vault_status,
            vault::vault_session_active,
            vault::vault_auto_lock_state,
            vault::vault_set_auto_lock_paused,
            vault::vault_create,
            discovery::discover_mail_servers,
            vault::vault_unlock,
            vault::vault_quick_unlock,
            vault::vault_configure_quick_unlock,
            vault::vault_lock,
            vault::vault_account,
            vault::vault_save_account,
            #[cfg(target_os = "macos")]
            direct_import::vault_direct_request,
            #[cfg(target_os = "macos")]
            direct_import::vault_link_mailspring,
            #[cfg(target_os = "macos")]
            direct_import::vault_direct_approve,
            #[cfg(target_os = "macos")]
            direct_import::vault_direct_cancel,
            vault::vault_load_import_request,
            vault::vault_export,
            vault::vault_save_profile,
            vault::vault_move_account,
            vault::vault_delete_accounts,
            vault::vault_touch,
        ]);

    builder
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
