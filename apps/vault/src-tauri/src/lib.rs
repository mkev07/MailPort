use tauri::Manager;

mod discovery;
#[cfg(target_os = "macos")]
mod macos;
mod profiles;
mod quick_unlock;
mod vault;
#[cfg(target_os = "macos")]
mod vault_lifecycle;
mod window;

const WINDOW_STATE_FILE: &str = ".window-state-v3.json";

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
            vault::vault_load_import_request,
            vault::vault_export,
            vault::vault_save_profile,
            vault::vault_move_account,
            vault::vault_delete_accounts,
            vault::vault_demo,
            vault::vault_touch,
        ]);

    builder
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
