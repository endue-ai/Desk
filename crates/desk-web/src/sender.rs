//! Who a frame is: the shell's runtime on `desk-app://app/`, one plugin on its surface host of
//! `desk-plugin` (#36), the palette or the floating Eris window, or nobody the desk knows. The CEF
//! shell takes a bridge call's caller from this, never from the call (#43). The palette and Eris
//! pages load from the same `desk-app://app/` as the runtime, so their identity comes from the
//! window the browser process made the frame's browser for ([`Role`]), which no page can claim
//! (#45); the URL only says whether the frame is the desk's own page there. Those three are the
//! desk's system surfaces ([`System`], #55, ADR 0160), and the parts of the desk's page that the
//! compositor places in its system layer have stable ids too ([`PARTS`]).

use crate::plugin_scheme::hosts::Host;

mod system;
pub use system::{Level, PARTS, System, SystemPart, part};

/// The runtime's caller id (desk-boot's `RUNTIME_CALLER`).
pub const RUNTIME: &str = "desk";
/// The palette window's fixed caller: one segment, so no installed plugin can have it.
pub const PALETTE: &str = "palette";

/// The commands of each window, as the Tauri shell's capabilities allowed them (its
/// `capabilities/*.json`, deleted with it when Stage 1 of #32 ended).
const MAIN_COMMANDS: &[&str] = &[
    "desk_ready",
    "desk_start",
    "desk_relaunch",
    "desk_trace",
    "take_open_files",
    "desk_crash",
    "take_last_crash",
    "palette_reveal_main",
    "plugin:dialog|open",
    // The answer to a quit the person asked for: asking about unsaved changes, quit or stay (#163).
    "desk_quit",
    // Compositor mode (#52, #81): the desk the runtime keeps; captures and counts for checks in
    // development builds. Input (#56): the keymap's entries and the page's focus; events fed to the
    // window's input and where input goes, for checks in development builds.
    "compositor_desk",
    "compositor_capture",
    "compositor_stats",
    "compositor_keys",
    "compositor_focus",
    "compositor_input",
    "compositor_input_state",
    // The window manager (#80): a press the page found starts a gesture, a window command; the
    // runtime's edits of its state and what desk.windows.list answers (#83).
    "compositor_grab",
    "compositor_wm",
    "compositor_edit",
    "compositor_snapshot",
    // Accessibility (#57): the tree the platform adapter has, and a screen reader's request, for
    // checks in development builds.
    "compositor_a11y",
    // The window manager's clock held at a time a check chooses (#54, development builds).
    "compositor_clock",
    // The main window closed, minimized or brought back as a person does it, for checks of a desk
    // out of sight (#155, development builds).
    "compositor_window",
];
const PALETTE_COMMANDS: &[&str] = &[
    "palette_hide",
    "palette_reveal_main",
    "palette_prepare_main",
    "palette_present",
];
const ERIS_COMMANDS: &[&str] = &[
    "plugin:eris-window|state",
    "plugin:eris-window|dismiss",
    "plugin:eris-window|expand",
    "plugin:eris-window|drag",
    "plugin:eris-window|reveal_main",
];
/// What the floating Eris may ask the core as the desk: talking to Eris and her brain's status
/// (ADR 0121). Everything else the desk may do stays with the main window.
const ERIS_METHODS: &[&str] = &["brain.say", "brain.status"];

/// Which of the shell's windows a browser is, set by the browser process when it makes the browser.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Role {
    /// The desk itself: the runtime and its plugin frames.
    Main,
    /// Search Desk over every app (`?view=palette`).
    Palette,
    /// The floating Eris window (`?view=eris`, ADR 0121).
    Eris,
    /// The computer-use banner (ADR 0120): a plugin page without the bridge.
    Banner,
}

/// The origin a frame belongs to, as the bridge sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Sender {
    /// The shell's own page: it hosts plugins and may call for one it names.
    Runtime,
    /// The palette window's page: it calls as `palette`.
    Palette,
    /// The floating Eris window's page: it calls as the desk, to talk to Eris only.
    Eris,
    /// A plugin's frame: it calls as itself, whatever it claims.
    Plugin(String),
    /// Anything else: no bridge.
    Unknown,
}

impl Sender {
    /// The sender of a frame at `url`, from the URL alone.
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
        match Host::parse(host) {
            Some(Host::Surface { plugin, .. }) => Self::Plugin(plugin),
            _ => Self::Unknown,
        }
    }

    /// The sender of a frame at `url` in a browser of `role`: the desk's own page in the palette or
    /// the Eris window is that window, never the runtime; plugin frames are themselves anywhere.
    pub fn in_role(role: Role, url: &str) -> Self {
        match (role, Self::of(url)) {
            (Role::Main, sender) => sender,
            (Role::Palette, Self::Runtime) => Self::Palette,
            (Role::Eris, Self::Runtime) => Self::Eris,
            (Role::Banner, Self::Runtime) => Self::Unknown,
            (_, sender) => sender,
        }
    }

    /// The caller a bridge call from this sender runs as, `named` being the caller the call names:
    /// the runtime may call for a plugin it hosts; the palette, Eris and a plugin are always
    /// themselves; others are refused.
    pub fn caller(&self, named: Option<&str>) -> Option<String> {
        match self {
            Self::Runtime => Some(named.unwrap_or(RUNTIME).to_owned()),
            Self::Palette => Some(PALETTE.to_owned()),
            Self::Eris => Some(RUNTIME.to_owned()),
            Self::Plugin(id) => Some(id.clone()),
            Self::Unknown => None,
        }
    }

    /// Whether this sender may ask the core for `method`: the Eris window only talks to Eris.
    pub fn may_ask(&self, method: &str) -> Result<(), String> {
        match self {
            Self::Eris if !ERIS_METHODS.contains(&method) => Err(format!(
                "the floating Eris window talks to Eris only, not {method}"
            )),
            _ => Ok(()),
        }
    }

    /// Whether this sender may use the shell's own command `cmd` (`desk_ready`, `palette_hide`, …).
    pub fn may(&self, cmd: &str) -> bool {
        let allowed = match self {
            Self::Runtime => MAIN_COMMANDS,
            Self::Palette => PALETTE_COMMANDS,
            Self::Eris => ERIS_COMMANDS,
            Self::Plugin(_) | Self::Unknown => &[],
        };
        allowed.contains(&cmd)
    }
}

#[cfg(test)]
mod tests {
    use super::{Role, Sender};

    #[test]
    fn the_runtime_may_name_a_caller_and_a_plugin_never_can() {
        let runtime = Sender::of("desk-app://app/index.html");
        assert_eq!(runtime, Sender::Runtime);
        assert_eq!(runtime.caller(None).as_deref(), Some("desk"));
        assert_eq!(
            runtime.caller(Some("endue.notes")).as_deref(),
            Some("endue.notes")
        );
        assert!(runtime.may("desk_ready"));

        let plugin = Sender::of("desk-plugin://main.endue-notes/endue.notes/ui/index.html");
        assert_eq!(plugin, Sender::Plugin("endue.notes".to_owned()));
        assert_eq!(plugin.caller(Some("desk")).as_deref(), Some("endue.notes"));
        assert!(!plugin.may("desk_ready"));
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

    #[test]
    fn the_palette_and_eris_are_their_window_never_their_url() {
        // The main window's page is the runtime whatever view its URL asks for.
        let url = "desk-app://app/index.html?view=palette";
        assert_eq!(Sender::in_role(Role::Main, url), Sender::Runtime);
        // The palette window's page calls as `palette`, whatever caller it names.
        let palette = Sender::in_role(Role::Palette, url);
        assert_eq!(palette, Sender::Palette);
        assert_eq!(palette.caller(Some("desk")).as_deref(), Some("palette"));
        assert_eq!(palette.caller(None).as_deref(), Some("palette"));
        // The Eris window's page calls as the desk, even naming a plugin.
        let eris = Sender::in_role(Role::Eris, "desk-app://app/index.html?view=eris");
        assert_eq!(eris, Sender::Eris);
        assert_eq!(eris.caller(Some("endue.notes")).as_deref(), Some("desk"));
        // A plugin frame is itself in any window; other pages get nothing anywhere.
        let frame = "desk-plugin://main.endue-notes/endue.notes/ui/index.html";
        for role in [Role::Main, Role::Palette, Role::Eris, Role::Banner] {
            assert_eq!(
                Sender::in_role(role, frame),
                Sender::Plugin("endue.notes".to_owned()),
                "{role:?}"
            );
            assert_eq!(
                Sender::in_role(role, "https://example.com/"),
                Sender::Unknown,
                "{role:?}"
            );
            assert_eq!(
                Sender::in_role(role, "desk-plugin://localhost/_desk/palette/index.html"),
                Sender::Unknown,
                "{role:?}"
            );
        }
        // The banner never has the desk's page; if it had, it would get no bridge.
        assert_eq!(
            Sender::in_role(Role::Banner, "desk-app://app/index.html"),
            Sender::Unknown
        );
    }

    #[test]
    fn each_window_has_the_commands_its_tauri_capability_had() {
        let runtime = Sender::Runtime;
        for cmd in [
            "desk_ready",
            "take_open_files",
            "plugin:dialog|open",
            "palette_reveal_main",
            "desk_quit",
        ] {
            assert!(runtime.may(cmd), "{cmd}");
        }
        // Only the desk's page answers a quit: a plugin cannot quit the desk or hold its quit.
        assert!(!Sender::Plugin("endue.notes".into()).may("desk_quit"));
        assert!(!Sender::Palette.may("desk_quit"));
        assert!(!runtime.may("palette_hide"));
        assert!(!runtime.may("plugin:eris-window|drag"));
        // Compositor mode (#52, #81): the shell page publishes its desk; nobody else does.
        assert!(
            !runtime.may("compositor_layout"),
            "the frames' report is gone"
        );
        for cmd in [
            "compositor_desk",
            "compositor_capture",
            "compositor_stats",
            "compositor_keys",
            "compositor_focus",
            "compositor_input",
            "compositor_input_state",
            "compositor_grab",
            "compositor_wm",
            "compositor_a11y",
            "compositor_clock",
            "compositor_window",
        ] {
            assert!(runtime.may(cmd), "{cmd}");
            assert!(!Sender::Plugin("endue.notes".into()).may(cmd), "{cmd}");
            assert!(!Sender::Palette.may(cmd), "{cmd}");
        }
        let palette = Sender::Palette;
        for cmd in [
            "palette_hide",
            "palette_present",
            "palette_reveal_main",
            "palette_prepare_main",
        ] {
            assert!(palette.may(cmd), "{cmd}");
        }
        for cmd in [
            "desk_ready",
            "desk_relaunch",
            "plugin:dialog|open",
            "take_open_files",
        ] {
            assert!(!palette.may(cmd), "{cmd}");
        }
        let eris = Sender::Eris;
        for cmd in ["state", "dismiss", "expand", "drag", "reveal_main"] {
            assert!(eris.may(&format!("plugin:eris-window|{cmd}")), "{cmd}");
        }
        for cmd in [
            "desk_ready",
            "palette_hide",
            "plugin:dialog|open",
            "desk_crash",
        ] {
            assert!(!eris.may(cmd), "{cmd}");
        }
        for sender in [Sender::Plugin("endue.notes".to_owned()), Sender::Unknown] {
            assert!(!sender.may("desk_ready"));
            assert!(!sender.may("palette_hide"));
        }
    }

    #[test]
    fn the_eris_window_asks_the_core_for_her_conversation_only() {
        let eris = Sender::Eris;
        assert!(eris.may_ask("brain.say").is_ok());
        assert!(eris.may_ask("brain.status").is_ok());
        for method in [
            "fs.read",
            "settings.set",
            "cmd.invoke",
            "net.fetch",
            "plugin.list",
        ] {
            let refused = eris.may_ask(method).unwrap_err();
            assert!(refused.contains(method), "{refused}");
        }
        // Everyone else is checked by the core's permissions alone.
        for sender in [
            Sender::Runtime,
            Sender::Palette,
            Sender::Plugin("x.y".into()),
        ] {
            assert!(sender.may_ask("fs.read").is_ok());
        }
    }
}
