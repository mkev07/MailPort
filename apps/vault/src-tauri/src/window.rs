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

#[tauri::command]
pub fn system_accent_color() -> Option<[u8; 3]> {
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSColor, NSColorSpace};
        let color =
            NSColor::controlAccentColor().colorUsingColorSpace(&NSColorSpace::sRGBColorSpace())?;
        return Some(
            [
                color.redComponent(),
                color.greenComponent(),
                color.blueComponent(),
            ]
            .map(|component| (component.clamp(0.0, 1.0) * 255.0).round() as u8),
        );
    }
    #[cfg(not(target_os = "macos"))]
    None
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

#[cfg(target_os = "macos")]
pub(crate) const MAX_GLASS_CONTROLS: usize = 128;

#[cfg(target_os = "macos")]
#[derive(Deserialize)]
pub(crate) struct AppearanceSliderSpec {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) value: u8,
}

#[derive(Deserialize)]
pub struct GlassBounds {
    #[cfg(target_os = "macos")]
    pub(crate) left: f64,
    #[cfg(target_os = "macos")]
    pub(crate) top: f64,
    #[cfg(target_os = "macos")]
    pub(crate) width: f64,
    #[cfg(target_os = "macos")]
    pub(crate) height: f64,
    #[cfg(target_os = "macos")]
    pub(crate) radius: f64,
    #[cfg(target_os = "macos")]
    pub(crate) interactive: bool,
    #[cfg(target_os = "macos")]
    pub(crate) destructive: bool,
    #[cfg(target_os = "macos")]
    pub(crate) panel: bool,
    #[cfg(target_os = "macos")]
    #[serde(rename = "inDialog", default)]
    pub(crate) in_dialog: bool,
    #[cfg(target_os = "macos")]
    pub(crate) tint: Option<[u8; 3]>,
    #[cfg(target_os = "macos")]
    #[serde(rename = "neutralTint", default)]
    pub(crate) neutral_tint: Option<u8>,
    #[cfg(target_os = "macos")]
    #[serde(default)]
    pub(crate) light: bool,
    #[cfg(target_os = "macos")]
    #[serde(default)]
    pub(crate) slider: Option<AppearanceSliderSpec>,
}

#[tauri::command]
pub fn set_vault_control_glass(window: WebviewWindow, controls: Vec<GlassBounds>) -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        if crate::macos::is_live_resizing(&window) {
            crate::macos::set_vault_control_glass(&window, &[]);
            return None;
        }
        let valid = controls.len() <= MAX_GLASS_CONTROLS
            && controls.iter().filter(|rect| rect.panel).count() <= 1
            && controls.iter().all(|rect| {
                rect.left >= 0.0
                    && rect.top >= 0.0
                    && rect.width > 0.0
                    && rect.height > 0.0
                    && rect.radius >= 0.0
                    && rect.radius <= rect.height / 2.0
                    && rect.left + rect.width <= 1.001
                    && rect.top + rect.height <= 1.001
            });
        if !valid {
            crate::macos::set_vault_control_glass(&window, &[]);
            return Some(false);
        }
        Some(crate::macos::set_vault_control_glass(&window, &controls))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, controls);
        Some(false)
    }
}
