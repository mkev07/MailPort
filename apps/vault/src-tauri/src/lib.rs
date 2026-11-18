use tauri::Manager;

#[cfg(target_os = "macos")]
mod macos;
mod vault;
mod window;

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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            vault::setup(app)?;
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
            vault::vault_status,
            vault::vault_create,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_account,
            vault::vault_save_account,
            vault::vault_export,
            vault::vault_demo,
            vault::vault_touch,
        ]);

    builder
        .build(context)
        .expect("error while building tauri application")
        .run(|_app, _event| {});
}
