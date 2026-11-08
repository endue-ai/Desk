//! Which proxy a connection goes through. When any proxy variable of the environment is set, the
//! environment alone decides; otherwise the system's PAC file, then its manual proxy for the scheme
//! minus its bypass list, then direct. Loopback always goes direct, as browsers do.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use url::{Host, Url};

mod bypass;
mod cache;
#[cfg(target_os = "macos")]
mod macos;
mod pac;
#[cfg(windows)]
mod windows;

pub use pac::Pac;

/// The way to a server.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Route {
    Direct,
    /// Through the proxy at this URL: `http` (CONNECT), `https`, `socks4`, `socks5` or `socks5h`.
    Proxy(String),
}

/// The variables that name a proxy, lowercase first.
const PROXY_VARS: [&str; 6] = [
    "http_proxy",
    "HTTP_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "all_proxy",
    "ALL_PROXY",
];

/// An environment's proxy variables: `http_proxy`, `https_proxy`, `all_proxy` and `no_proxy`, each
/// lowercase or uppercase. An empty variable counts as unset.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Env {
    vars: BTreeMap<String, String>,
}

impl Env {
    /// This process's variables, read now.
    pub fn current() -> Self {
        PROXY_VARS
            .iter()
            .chain(&["no_proxy", "NO_PROXY"])
            .filter_map(|name| std::env::var(name).ok().map(|value| (*name, value)))
            .collect()
    }

    fn get(&self, name: &str) -> Option<&str> {
        self.vars
            .get(name)
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
    }

    fn either(&self, lower: &str, upper: &str) -> Option<&str> {
        self.get(lower).or_else(|| self.get(upper))
    }

    /// Whether a proxy variable is set, so the environment decides alone.
    fn decides(&self) -> bool {
        PROXY_VARS.iter().any(|name| self.get(name).is_some())
    }

    /// The scheme's variable, then `all_proxy`, minus `no_proxy`.
    fn route(&self, url: &Url, host: &Host<&str>) -> Route {
        let scheme = match secure(url) {
            true => self.either("https_proxy", "HTTPS_PROXY"),
            false => self.either("http_proxy", "HTTP_PROXY"),
        };
        let Some(proxy) = scheme.or_else(|| self.either("all_proxy", "ALL_PROXY")) else {
            return Route::Direct;
        };
        let no_proxy = self.either("no_proxy", "NO_PROXY").unwrap_or_default();
        match bypass::no_proxy(no_proxy, host) {
            true => Route::Direct,
            false => Route::Proxy(proxy_url(proxy)),
        }
    }
}

impl<K: Into<String>, V: Into<String>> FromIterator<(K, V)> for Env {
    fn from_iter<I: IntoIterator<Item = (K, V)>>(vars: I) -> Self {
        Self {
            vars: vars
                .into_iter()
                .map(|(name, value)| (name.into(), value.into()))
                .collect(),
        }
    }
}

/// The system's proxy settings: macOS's dynamic store, Windows's Internet Settings; none on Linux,
/// where the environment is the setting. WPAD discovery is not read.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Settings {
    /// The PAC file's URL (http, https or file), when automatic configuration is on.
    pub pac_url: Option<String>,
    /// The manual proxy for http and ws URLs, as a proxy URL (`http://host:port`).
    pub http: Option<String>,
    /// The manual proxy for https and wss URLs.
    pub https: Option<String>,
    /// Hosts the manual proxy is bypassed for: names with `*` wildcards, IP prefixes (`10.*`) and
    /// CIDRs (`169.254/16`), matched without DNS.
    pub bypass: Vec<String>,
    /// Names without a dot bypass the manual proxy (Windows `<local>`, macOS
    /// `ExcludeSimpleHostnames`).
    pub bypass_simple: bool,
}

impl Settings {
    /// This computer's settings, read now.
    pub fn system() -> Self {
        #[cfg(target_os = "macos")]
        return macos::settings();
        #[cfg(windows)]
        return windows::settings();
        #[cfg(not(any(target_os = "macos", windows)))]
        Self::default()
    }

    /// The settings that the values of `HKCU\Software\Microsoft\Windows\CurrentVersion\Internet
    /// Settings` make; a missing value is "". `ProxyServer` is `host:port` for every scheme or
    /// `scheme=host:port;...` (the `http` and `https` entries are used); `ProxyOverride` is a `;`
    /// list where `<local>` stands for names without a dot. `ProxyEnable` 0 turns the manual proxy
    /// off; `AutoConfigURL` is kept either way.
    pub fn from_windows(
        proxy_enable: u32,
        proxy_server: &str,
        proxy_override: &str,
        auto_config_url: &str,
    ) -> Self {
        let mut settings = Self {
            pac_url: Some(auto_config_url.trim().to_owned()).filter(|url| !url.is_empty()),
            ..Self::default()
        };
        for entry in proxy_override.split(';').map(str::trim) {
            match entry {
                "" => {}
                "<local>" => settings.bypass_simple = true,
                entry => settings.bypass.push(entry.to_owned()),
            }
        }
        if proxy_enable == 0 {
            return settings;
        }
        for entry in proxy_server.split(';').map(str::trim) {
            match entry.split_once('=') {
                None if !entry.is_empty() => {
                    settings.http = Some(proxy_url(entry));
                    settings.https = Some(proxy_url(entry));
                }
                Some((scheme, proxy)) if !proxy.trim().is_empty() => {
                    match scheme.trim().to_ascii_lowercase().as_str() {
                        "http" => settings.http = Some(proxy_url(proxy)),
                        "https" => settings.https = Some(proxy_url(proxy)),
                        _ => {}
                    }
                }
                _ => {}
            }
        }
        settings
    }

    /// The manual proxy for the scheme, minus the bypass list.
    fn route(&self, url: &Url, host: &Host<&str>) -> Route {
        let proxy = match secure(url) {
            true => &self.https,
            false => &self.http,
        };
        match proxy {
            Some(proxy) if !bypass::system(&self.bypass, self.bypass_simple, host) => {
                Route::Proxy(proxy.clone())
            }
            _ => Route::Direct,
        }
    }
}

/// Chooses the route of each connection, keeping the PAC files it loads for 5 minutes.
pub struct Resolver {
    /// None reads the process environment and the system settings again for every route.
    fixed: Option<(Env, Settings)>,
    pacs: cache::Pacs,
}

impl Resolver {
    /// The process environment and this computer's settings, read again for every route.
    pub fn system() -> Self {
        Self {
            fixed: None,
            pacs: cache::Pacs::default(),
        }
    }

    /// A fixed environment and settings.
    pub fn new(env: Env, settings: Settings) -> Self {
        Self {
            fixed: Some((env, settings)),
            pacs: cache::Pacs::default(),
        }
    }

    /// The route to `url`'s server: direct for loopback and for a URL without a host; the
    /// environment when it names a proxy; otherwise the PAC file, then the manual proxy, then
    /// direct. A PAC file that fails to load, throws or answers nonsense falls back.
    pub fn route(&self, url: &str) -> Route {
        let Ok(url) = Url::parse(url) else {
            return Route::Direct;
        };
        let Some(host) = url.host() else {
            return Route::Direct;
        };
        if loopback(&host) {
            return Route::Direct;
        }
        let (current, system);
        let (env, fixed) = match &self.fixed {
            Some((env, settings)) => (env, Some(settings)),
            None => {
                current = Env::current();
                (&current, None)
            }
        };
        if env.decides() {
            return env.route(&url, &host);
        }
        let settings = match fixed {
            Some(settings) => settings,
            None => {
                system = Settings::system();
                &system
            }
        };
        if let Some(pac_url) = &settings.pac_url
            && let Some(route) = self.pacs.route(pac_url, &url)
        {
            return route;
        }
        settings.route(&url, &host)
    }
}

/// The resolver fetch and the streams use: the system's, with one PAC cache for the process.
pub(super) fn resolver() -> &'static Resolver {
    static RESOLVER: OnceLock<Resolver> = OnceLock::new();
    RESOLVER.get_or_init(Resolver::system)
}

/// https and wss take the https proxy; http and ws the http one.
fn secure(url: &Url) -> bool {
    matches!(url.scheme(), "https" | "wss")
}

/// `localhost`, `*.localhost`, 127.0.0.0/8 and `::1`.
fn loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name == "localhost" || name.ends_with(".localhost")
        }
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// A proxy URL without its credentials, for messages.
pub(super) fn shown(proxy: &str) -> String {
    match Url::parse(proxy) {
        Ok(mut url) => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.to_string()
        }
        Err(_) => "(not a URL)".to_owned(),
    }
}

/// A proxy as a URL: `host:port` alone is an http proxy.
fn proxy_url(proxy: &str) -> String {
    let proxy = proxy.trim();
    match proxy.contains("://") {
        true => proxy.to_owned(),
        false => format!("http://{proxy}"),
    }
}
