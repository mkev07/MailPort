use serde::Deserialize;
use tauri::window::Color;
use tauri::WebviewWindow;
#[cfg(target_os = "windows")]
use tauri::{window::Effect, window::EffectsBuilder};

/// The page colour to fill the window with when glass is off. Not a constant:
/// Linux can turn glass off in dark mode, not just light.
#[derive(Clone, Copy, Deserialize)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

// macOS hands the components to AppKit instead, so it has no use for this.
#[cfg(any(target_os = "windows", target_os = "linux"))]
impl Rgb {
    fn fill(self) -> Color {
        Color(self.r, self.g, self.b, 255)
    }
}

/// Desktop blur goes on after the first UI paint and only in dark mode.
#[tauri::command]
pub fn set_window_glass_enabled(
    window: WebviewWindow,
    enabled: bool,
    background: Rgb,
    opacity: Option<f64>,
) -> bool {
    #[cfg(target_os = "macos")]
    {
        if enabled {
            let _ = window.set_background_color(Some(Color(0, 0, 0, 3)));
            return crate::macos::enable_glass(&window, background, opacity);
        } else {
            crate::macos::disable_glass(&window, background.r, background.g, background.b);
        }
    }
    #[cfg(target_os = "windows")]
    {
        if enabled {
            let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
            let _ = window.set_effects(EffectsBuilder::new().effect(Effect::Acrylic).build());
        } else {
            let _ = window.set_effects(None);
            let _ = window.set_background_color(Some(background.fill()));
        }
    }
    #[cfg(target_os = "linux")]
    {
        // No system blur API on Linux: transparency only.
        let _ = window.set_background_color(Some(if enabled {
            Color(0, 0, 0, 0)
        } else {
            background.fill()
        }));
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = (window, enabled, background);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = opacity;
    false
}
