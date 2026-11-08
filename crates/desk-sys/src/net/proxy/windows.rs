//! The proxy settings of Windows: the current user's Internet Settings in the registry.

use windows_registry::CURRENT_USER;

use super::Settings;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

/// `ProxyEnable`, `ProxyServer`, `ProxyOverride` and `AutoConfigURL`, through
/// `Settings::from_windows`. A missing key or value reads as unset.
pub(super) fn settings() -> Settings {
    let Ok(key) = CURRENT_USER.open(KEY) else {
        return Settings::default();
    };
    let text = |name: &str| key.get_string(name).unwrap_or_default();
    Settings::from_windows(
        key.get_u32("ProxyEnable").unwrap_or(0),
        &text("ProxyServer"),
        &text("ProxyOverride"),
        &text("AutoConfigURL"),
    )
}
