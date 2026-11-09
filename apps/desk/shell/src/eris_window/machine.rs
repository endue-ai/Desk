//! What the floating Eris does (ADR 0121), as a pure state machine. In go the focus of the desk's
//! windows (main, palette, the floating window), whether the main window is on screen (shown and
//! not minimized), `endue.eris.float`, the shortcut and Esc; out come showing, hiding and summoning
//! her. The window layer (`eris_window.rs`) feeds it and carries out what it returns, so every rule
//! here is tested without a window. Ported from the Tauri shell.

/// `endue.eris.float`: whether Eris floats over the OS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Float {
    /// While the desk is not the active app (the default).
    #[default]
    Auto,
    /// All the time, over the active desk too.
    Always,
    /// Never: the shortcut brings the desk forward and opens her composer there.
    Never,
}

impl Float {
    /// The setting's value; anything else (absent, misspelt) is the default.
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("always") => Self::Always,
            Some("never") => Self::Never,
            _ => Self::Auto,
        }
    }
}

/// The desk's windows whose focus the machine follows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Win {
    Main,
    Palette,
    Eris,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Event {
    /// A window gained (true) or lost (false) the focus.
    Focus(Win, bool),
    /// The main window is on screen: shown and not minimized.
    MainOnScreen(bool),
    /// `endue.eris.float` as it is now; the machine settles under it.
    Mode(Float),
    /// The global shortcut, or the tray's Talk to Eris.
    Shortcut,
    /// Esc in the floating window, or its close request: she goes away until the desk is next in
    /// front or she is summoned.
    Dismiss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Effect {
    /// Show the floating window. `summon` focuses it with her composer open; otherwise it shows
    /// without taking the focus from the app in front.
    Show { summon: bool },
    /// Hide the floating window and fold its composer.
    Hide,
    /// Run `desk.eris.summon` in the main window: open her composer there, or, with `toggle`,
    /// close it when it is open.
    TalkInDesk { toggle: bool },
    /// Bring the main window forward.
    RevealMain,
}

#[derive(Debug, Clone)]
pub struct Machine {
    mode: Float,
    /// The desk has been in front once in this run: before that nothing floats (a desk started in
    /// the background, or under a display with no window manager, never reports its focus).
    seen: bool,
    main_focused: bool,
    main_on_screen: bool,
    palette_focused: bool,
    eris_focused: bool,
    shown: bool,
    dismissed: bool,
}

impl Machine {
    /// Nothing floats until the desk has been in front once; the shortcut summons her anyway.
    pub fn new(mode: Float) -> Self {
        Self {
            mode,
            seen: false,
            main_focused: false,
            main_on_screen: true,
            palette_focused: false,
            eris_focused: false,
            shown: false,
            dismissed: false,
        }
    }

    /// Whether the floating window is meant to be on screen.
    #[cfg(test)]
    pub fn shown(&self) -> bool {
        self.shown
    }

    /// The desk is the active app with its main window in front of the person.
    pub fn desk_active(&self) -> bool {
        self.main_focused && self.main_on_screen
    }

    /// Take one event. Focus and on-screen changes return nothing: they come in bursts (one window
    /// blurs before the next one focuses), so the caller calls `settle` once they have stopped.
    pub fn on(&mut self, event: Event) -> Vec<Effect> {
        match event {
            Event::Focus(win, focused) => {
                match win {
                    Win::Main => {
                        // The desk in front again: a dismissed Eris may float the next time it is not.
                        if focused && !self.main_focused {
                            self.dismissed = false;
                        }
                        self.seen |= focused;
                        self.main_focused = focused;
                    }
                    Win::Palette => self.palette_focused = focused,
                    Win::Eris => self.eris_focused = focused,
                }
                Vec::new()
            }
            Event::MainOnScreen(on) => {
                self.main_on_screen = on;
                Vec::new()
            }
            Event::Mode(mode) => {
                self.mode = mode;
                self.settle()
            }
            Event::Shortcut => self.shortcut(),
            Event::Dismiss => {
                self.dismissed = true;
                self.eris_focused = false;
                self.show(false)
            }
        }
    }

    /// Show or hide the floating window for the focus as it stands.
    pub fn settle(&mut self) -> Vec<Effect> {
        // The palette passes through (it opens over any app and hands back): leave her as she is.
        if self.palette_focused {
            return Vec::new();
        }
        let wanted = match self.mode {
            Float::Never => false,
            // Never pull her away from under the person's hands.
            _ if self.eris_focused => true,
            _ if !self.seen => false,
            Float::Always => !self.dismissed,
            Float::Auto => !self.desk_active() && !self.dismissed,
        };
        self.show(wanted)
    }

    fn shortcut(&mut self) -> Vec<Effect> {
        if self.desk_active() {
            return vec![Effect::TalkInDesk { toggle: true }];
        }
        if self.mode == Float::Never {
            return vec![Effect::RevealMain, Effect::TalkInDesk { toggle: false }];
        }
        // Pressed again while she is in front: she goes away.
        if self.shown && self.eris_focused {
            self.dismissed = true;
            self.eris_focused = false;
            return self.show(false);
        }
        self.dismissed = false;
        self.shown = true;
        vec![Effect::Show { summon: true }]
    }

    fn show(&mut self, shown: bool) -> Vec<Effect> {
        if shown == self.shown {
            return Vec::new();
        }
        self.shown = shown;
        vec![if shown {
            Effect::Show { summon: false }
        } else {
            Effect::Hide
        }]
    }
}
