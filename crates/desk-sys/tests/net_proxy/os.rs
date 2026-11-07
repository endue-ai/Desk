//! What the OS's own tools print about the proxy settings, as `Settings`, for the ignored tests of
//! tests/net_proxy.rs that compare it with `Settings::system()`.

#![allow(dead_code)]

use std::process::Command;

use desk_sys::net::proxy::Settings;

/// `scutil --proxy` on macOS: the top-level keys of the dynamic store's proxy dictionary.
pub fn scutil() -> (Settings, String) {
    let output = Command::new("scutil").arg("--proxy").output().unwrap();
    let text = String::from_utf8(output.stdout).unwrap();
    // Top-level keys sort before __SCOPED__, whose per-interface dictionaries repeat them.
    let value = |key: &str| {
        text.lines()
            .filter_map(|line| line.trim().split_once(" : "))
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.trim().to_owned())
    };
    let on = |key: &str| value(key).as_deref() == Some("1");
    let manual = |scheme: &str| {
        on(&format!("{scheme}Enable")).then(|| {
            let host = value(&format!("{scheme}Proxy")).unwrap_or_default();
            let port = value(&format!("{scheme}Port")).unwrap_or_default();
            format!("http://{host}:{port}")
        })
    };
    let bypass = text
        .lines()
        .map(str::trim)
        .skip_while(|line| !line.starts_with("ExceptionsList : <array>"))
        .skip(1)
        .take_while(|line| *line != "}")
        .filter_map(|line| line.split_once(" : ").map(|(_, entry)| entry.to_owned()))
        .collect();
    let settings = Settings {
        pac_url: on("ProxyAutoConfigEnable")
            .then(|| value("ProxyAutoConfigURLString"))
            .flatten(),
        http: manual("HTTP"),
        https: manual("HTTPS"),
        bypass,
        bypass_simple: on("ExcludeSimpleHostnames"),
    };
    (settings, text)
}

/// `reg query` of the current user's Internet Settings on Windows, through `Settings::from_windows`.
pub fn registry() -> (Settings, String) {
    let output = Command::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        ])
        .output()
        .unwrap();
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    let value = |name: &str| {
        text.lines()
            .map(|line| line.split_whitespace().collect::<Vec<_>>())
            .find(|words| words.first() == Some(&name) && words.len() >= 3)
            .map(|words| words[2..].join(" "))
            .unwrap_or_default()
    };
    let enable = value("ProxyEnable");
    let enable = u32::from_str_radix(enable.trim_start_matches("0x"), 16).unwrap_or(0);
    let settings = Settings::from_windows(
        enable,
        &value("ProxyServer"),
        &value("ProxyOverride"),
        &value("AutoConfigURL"),
    );
    (settings, text)
}
