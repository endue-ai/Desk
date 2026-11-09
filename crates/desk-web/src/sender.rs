//! Who a frame is, from its URL alone: the shell's runtime on `desk-app://app/`, one plugin on its
//! surface host of `desk-plugin` (#36), or nobody the desk knows. The CEF shell takes a bridge
//! call's caller from this, never from the call (#43).

use crate::plugin_host::PluginHost;

/// The runtime's caller id (desk-boot's `RUNTIME_CALLER`).
pub const RUNTIME: &str = "desk";

/// The origin a frame's URL belongs to, as the bridge sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Sender {
    /// The shell's own page: it hosts plugins and may call for one it names.
    Runtime,
    /// A plugin's frame: it calls as itself, whatever it claims.
    Plugin(String),
    /// Anything else: no bridge.
    Unknown,
}

impl Sender {
    /// The sender of a frame at `url`.
    pub fn of(url: &str) -> Self {
        if let Some(rest) = url.strip_prefix("desk-app://") {
            let host = rest.split(['/', '?', '#']).next().unwrap_or_default();
            return if host == "app" {
                Self::Runtime
            } else {
                Self::Unknown
            };
        }
        let host = url
            .strip_prefix("desk-plugin://")
            .or_else(|| url.strip_prefix("http://desk-plugin."))
            .map(|rest| rest.split(['/', '?', '#', ':']).next().unwrap_or_default());
        match host.and_then(PluginHost::parse) {
            Some(PluginHost::Surface { plugin, .. }) => Self::Plugin(plugin),
            _ => Self::Unknown,
        }
    }

    /// The caller a bridge call from this sender runs as, `named` being the caller the call names:
    /// the runtime may call for a plugin it hosts; a plugin is always itself; others are refused.
    pub fn caller(&self, named: Option<&str>) -> Option<String> {
        match self {
            Self::Runtime => Some(named.unwrap_or(RUNTIME).to_owned()),
            Self::Plugin(id) => Some(id.clone()),
            Self::Unknown => None,
        }
    }

    /// Whether this sender may use the shell's own commands (`desk_ready`, `desk_start`, …).
    pub fn may_command(&self) -> bool {
        *self == Self::Runtime
    }
}

#[cfg(test)]
mod tests {
    use super::Sender;

    #[test]
    fn the_runtime_may_name_a_caller_and_a_plugin_never_can() {
        let runtime = Sender::of("desk-app://app/index.html");
        assert_eq!(runtime, Sender::Runtime);
        assert_eq!(runtime.caller(None).as_deref(), Some("desk"));
        assert_eq!(
            runtime.caller(Some("endue.notes")).as_deref(),
            Some("endue.notes")
        );
        assert!(runtime.may_command());

        let plugin = Sender::of("desk-plugin://main.endue-notes/endue.notes/ui/index.html");
        assert_eq!(plugin, Sender::Plugin("endue.notes".to_owned()));
        assert_eq!(plugin.caller(Some("desk")).as_deref(), Some("endue.notes"));
        assert!(!plugin.may_command());
        assert_eq!(
            Sender::of("http://desk-plugin.main.endue-notes.localhost/endue.notes/ui/index.html"),
            Sender::Plugin("endue.notes".to_owned())
        );
    }

    #[test]
    fn other_pages_get_no_bridge() {
        for url in [
            "https://example.com/",
            "desk-app://evil/index.html",
            "desk-plugin://localhost/endue.palette/ui/index.html",
            "desk-plugin://nope/x",
            "about:blank",
            "",
        ] {
            let sender = Sender::of(url);
            assert_eq!(sender, Sender::Unknown, "{url}");
            assert_eq!(sender.caller(Some("desk")), None, "{url}");
        }
    }
}
