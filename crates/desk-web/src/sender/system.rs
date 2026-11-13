//! The desk's system surfaces and the parts of the desk's page the compositor places (#55, ADR
//! 0160): stable ids, the window each is a browser of, and the caller that window fixes.

use super::{PALETTE, RUNTIME, Role};

/// The desk's system surfaces (#55, ADR 0160): what stays web of the shell, each a browser the
/// browser process made for one of its windows, so its caller is fixed by that window, never by
/// what the page claims (ADR 0012's rule, #45). The desk starts the compositor, then these, in this
/// order. A plugin's surface in the system layer (the palette's overlay, the first run, the dock) is
/// its plugin's browser and calls as that plugin.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum System {
    /// The system layer: the runtime's page in the main window, off screen, drawn above every
    /// window (its parts in [`PARTS`]), and the plugin host of every plugin surface.
    Desk,
    /// Search Desk over every app, a window of its own.
    Palette,
    /// The island over every app (ADR 0204), a window of its own while `desk.island.show` is on.
    Island,
}

impl System {
    pub const ALL: [System; 3] = [System::Desk, System::Palette, System::Island];

    /// Its surface id: the compositor's for the desk's page, the shell's for the other windows.
    pub fn id(self) -> &'static str {
        match self {
            System::Desk => "desk",
            System::Palette => "palette",
            System::Island => "island",
        }
    }

    /// The window whose browser it is.
    pub fn role(self) -> Role {
        match self {
            System::Desk => Role::Main,
            System::Palette => Role::Palette,
            System::Island => Role::Island,
        }
    }

    /// The caller its bridge calls run as: the desk's, the palette's, and the island's, which is the
    /// runtime's (it asks only for its own part, [`Sender::may_ask`]).
    pub fn caller(self) -> &'static str {
        match self {
            System::Desk | System::Island => RUNTIME,
            System::Palette => PALETTE,
        }
    }

    /// The system surface a window's browser is, if any: the banner is a plugin page.
    pub fn of(role: Role) -> Option<System> {
        System::ALL.into_iter().find(|s| s.role() == role)
    }
}

/// One part of the desk's system surface that the compositor places in its system layer, above
/// every window and below the compositor's own overlays (ADR 0160): the page reports its box, and
/// the compositor draws the page's pixels there whole, or dims it for a modal's scrim.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SystemPart {
    /// Its stable id: `desk.` and what it is.
    pub id: &'static str,
    /// What it holds.
    pub holds: &'static str,
    /// How the compositor draws it, and where among what it draws of its own.
    pub level: Level,
}

/// Where a part goes among what the compositor draws of its own, the canvas map and a modal's
/// scrim, which the page cannot draw over the windows (ADR 0180).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    /// The page's pixels, whole, under the canvas map: the bars, the pills, Eris, the notices.
    Bar,
    /// A modal's scrim, which the page paints none of: the compositor fills its box with the
    /// theme's dialog scrim over everything under it, every window, the dock and the canvas map
    /// included, and the page hears the pointer there.
    Scrim,
    /// The page's pixels, whole, above the canvas map and every scrim: the settings, the studios,
    /// the dialogs, menus, hover cards and popovers.
    Front,
}

/// The parts the compositor draws over the windows that take no press of their own: one there is
/// for what lies under it. The status line's text is drawn over a window snapped to the top, whose
/// tools are its own page's (ADR 0201); its buttons are a part of their own.
const UNHEARD: &[&str] = &["desk.notices"];

impl SystemPart {
    /// The system surface it is a part of: the desk's, whose caller it calls as.
    pub fn surface(&self) -> System {
        System::Desk
    }

    /// Whether a press in its boxes is its own (the page's), never a window's under it.
    pub fn hears(&self) -> bool {
        !UNHEARD.contains(&self.id)
    }
}

/// The parts of the desk's system surface, in the order the compositor draws them: the bars, then
/// (after the canvas map, the compositor's) the scrims, then what the desk opens over them.
pub const PARTS: &[SystemPart] = &[
    SystemPart {
        id: "desk.profiles",
        holds: "the profile switcher, top left",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.desktops",
        holds: "the desktops, top right",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.agents",
        holds: "the agent bar's content: agents, spaces, local agents",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.account",
        holds: "the person's controls, bottom left",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.rail",
        holds: "the rail's content: the status drawers",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.arrange",
        holds: "the arrange strip beside the canvas map: tile, cascade, spread, restore",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.bottom",
        holds: "the bottom edge's controls, one box each: the drawer button, the talk pill and its \
                line, the running chips",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.canvas",
        holds: "the button that puts the canvas back where it started",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.safe",
        holds: "the safe mode badge and its button, top centre",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.eris",
        holds: "Eris: her figure, her soul text and her errands",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.notices",
        holds: "the status line and its notices, drawn over the windows: its text hears nothing",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.notice-actions",
        holds: "the status line's buttons, one box each: a notice's actions, its Dismiss, its Open",
        level: Level::Bar,
    },
    SystemPart {
        id: "desk.scrim",
        holds: "each modal's scrim the page has open, one box each: a dialog's, the settings' \
                backdrop",
        level: Level::Scrim,
    },
    SystemPart {
        id: "desk.settings",
        holds: "the settings window",
        level: Level::Front,
    },
    SystemPart {
        id: "desk.studios",
        holds: "the theme and design studios",
        level: Level::Front,
    },
    SystemPart {
        id: "desk.overlays",
        holds: "each popover, menu, hover title, card and dialog box the page has open, one box \
                each",
        level: Level::Front,
    },
];

/// The part `id` names, if it is one.
pub fn part(id: &str) -> Option<&'static SystemPart> {
    PARTS.iter().find(|p| p.id == id)
}

#[cfg(test)]
mod tests {
    use super::super::Sender;
    use super::{Level, PARTS, Role, System, part};

    #[test]
    fn each_system_surface_has_a_stable_id_a_window_and_the_caller_of_that_window() {
        let ids: Vec<&str> = System::ALL.iter().map(|s| s.id()).collect();
        assert_eq!(
            ids,
            ["desk", "palette", "island"],
            "the order the desk starts them in"
        );
        for system in System::ALL {
            assert_eq!(System::of(system.role()), Some(system));
            // The page at the desk's own URL calls as its window's caller (ADR 0012, #45).
            let sender = Sender::in_role(system.role(), "desk-app://app/index.html");
            assert_eq!(sender.caller(None).as_deref(), Some(system.caller()));
        }
        assert_eq!(System::Desk.caller(), "desk");
        assert_eq!(System::Palette.caller(), "palette");
        assert_eq!(
            System::Island.caller(),
            "desk",
            "the runtime's caller, for what the island shows only"
        );
        assert_eq!(
            System::of(Role::Banner),
            None,
            "a plugin page without the bridge"
        );
    }

    #[test]
    fn the_desks_system_surface_names_each_part_it_places_in_the_system_layer() {
        let mut ids: Vec<&str> = PARTS.iter().map(|p| p.id).collect();
        assert!(ids.iter().all(|id| id.starts_with("desk.")), "{ids:?}");
        for p in PARTS {
            assert_eq!(p.surface(), System::Desk);
            assert_eq!(part(p.id), Some(p));
        }
        for wanted in [
            "desk.agents",
            "desk.rail",
            // What the page draws over the dock takes its own presses (#158, #159).
            "desk.arrange",
            "desk.bottom",
            "desk.canvas",
            "desk.eris",
            "desk.notices",
            "desk.settings",
            "desk.overlays",
        ] {
            assert!(part(wanted).is_some(), "{wanted}");
        }
        assert_eq!(part("desk.nope"), None);
        let all = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), all, "each id once");
    }

    #[test]
    fn the_status_line_is_drawn_over_the_windows_and_only_its_buttons_hear_the_pointer() {
        // A window's tools under the line's text are the window's (ADR 0201): its page has them.
        let notices = part("desk.notices").expect("the status line");
        assert!(
            !notices.hears(),
            "drawn over the windows, its text takes no press"
        );
        let actions = part("desk.notice-actions").expect("its buttons");
        assert!(actions.hears());
        assert_eq!(actions.level, Level::Bar);
        for p in PARTS.iter().filter(|p| p.id != "desk.notices") {
            assert!(p.hears(), "{}", p.id);
        }
    }

    #[test]
    fn the_bars_go_under_the_canvas_map_and_a_scrim_and_what_the_desk_opens_over_them() {
        // A dialog over the map and the pill, its scrim over every window (#158, #161).
        let level = |id: &str| part(id).map(|p| p.level);
        for bar in ["desk.bottom", "desk.arrange", "desk.eris", "desk.notices"] {
            assert_eq!(level(bar), Some(Level::Bar), "{bar}");
        }
        assert_eq!(level("desk.scrim"), Some(Level::Scrim));
        for front in ["desk.settings", "desk.studios", "desk.overlays"] {
            assert_eq!(level(front), Some(Level::Front), "{front}");
        }
        // In drawing order: every bar, then the scrims, then the front.
        let levels: Vec<Level> = PARTS.iter().map(|p| p.level).collect();
        let mut sorted = levels.clone();
        sorted.sort_by_key(|l| *l as u8);
        assert_eq!(levels, sorted);
    }
}
