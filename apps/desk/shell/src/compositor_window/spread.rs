//! The spread on the compositor (#54, ADR 0116, ADR 0161): `desk.windows.spread` (the runtime's
//! command, `Op::Spread` through `compositor_wm`) opens `desk-wm`'s spread over the windows of the
//! desktop in front as the plan draws them, and `draw_spread.rs` draws every window at its pose
//! with its live surfaces. While it is open the spread hears the pointer and the keys before
//! anything else: the pointer over a card selects it and a click picks it, a drag or the wheel on
//! the scrim pans, Control + wheel zooms about the pointer, a click on the empty desk closes it,
//! the arrows, Tab, Home and End move, Enter picks, Escape closes, and typing (an input method's
//! commits too) filters by title. Chords go on to the keymap, so the spread's own key closes it.
//! Picking brings the window into sight (`Wm::reveal`), the cards go back to where the windows
//! are, and the runtime gives it the focus (`desk.windows.focus`). Its motions run on the window
//! manager's clock, which a check can hold (`compositor_clock`).

use std::time::Instant;

use desk_compositor::NodeId;
use desk_compositor::glam::Vec2;
use desk_compositor::input::{Button, ImeInput, Input, KeyInput, Modifiers};
use desk_surface::generated::SurfaceWheelUnit;
use desk_web::sender::Role;
use desk_wm::{Durations, Ending, KeyPress, Spread, SpreadAction, SpreadWindow};
use serde_json::{Value, json};

use super::CompositorWindow;
use super::wm::RUN;

/// A press on the scrim that moved less than this (CSS pixels) is a click: it closes the spread.
const CLICK: f64 = 4.0;
/// The runtime's command that gives the window picked the focus.
pub const FOCUS: &str = "desk.windows.focus";
/// A wheel's line, in CSS pixels.
const LINE: f64 = 16.0;

/// The spread's state between events.
#[derive(Debug, Default)]
pub struct Spreading {
    pub open: Option<Spread>,
    /// Each card's node as last drawn, the one a hit test finds, and its window.
    pub cards: Vec<(NodeId, String)>,
    /// A press on a card, until it is released.
    pressed: Option<String>,
    /// A press on the scrim: where the pointer was and how far it went.
    drag: Option<(Vec2, f64)>,
    /// The bar's nodes as last drawn: a press there is neither a card's nor the scrim's.
    pub bar: Vec<NodeId>,
    /// The modifiers held, which the keys' and the wheel's meaning depends on.
    mods: Modifiers,
    /// Where the pointer is, in device pixels: the spread and the map take moves the router then
    /// does not hear.
    pub at: Vec2,
}

impl Spreading {
    /// The window whose card is drawn at `node`.
    fn card(&self, node: NodeId) -> Option<&str> {
        let found = self.cards.iter().find(|(n, _)| *n == node);
        found.map(|(_, id)| id.as_str())
    }
}

impl CompositorWindow {
    /// The windows of the desktop in front as the spread shows them, where each is drawn now: one
    /// whose every plugin frame sleeps shows its last frame greyed.
    pub(super) fn spread_windows(&self) -> Vec<SpreadWindow> {
        let Some(plan) = self.hosted.plan() else {
            return Vec::new();
        };
        let away = |plugin: &str| self.hosted.frame(plugin).is_some_and(|f| f.state.away());
        (plan.windows.iter())
            .map(|w| {
                let plugins: Vec<&str> =
                    w.panes.iter().filter_map(|p| p.plugin.as_deref()).collect();
                SpreadWindow {
                    id: w.id.clone(),
                    title: w.title.clone(),
                    rect: w.rect,
                    asleep: !plugins.is_empty() && plugins.iter().all(|p| away(p)),
                }
            })
            .collect()
    }

    /// `desk.windows.spread`: open the spread, or close it with nothing picked.
    pub(super) fn spread_toggle(&mut self) {
        let now = self.hosted.ms(Instant::now());
        if let Some(open) = self.spreading.open.as_mut() {
            open.cancel(now);
            self.shared.lock().dirty = true;
            return;
        }
        let windows = self.spread_windows();
        let Some(plan) = self.hosted.plan() else {
            return;
        };
        let focused = (plan.windows.iter().find(|w| w.focused)).map(|w| w.id.clone());
        let screen = (plan.screen.w, plan.screen.h);
        let table = self.desk.core.theme_tokens();
        let token = |name: &str| table.tokens.get(name).cloned();
        let durations = Durations::from_tokens(token, table.reduced_motion);
        let flat = table.reduced_motion;
        let spread = Spread::open(windows, screen, flat, focused.as_deref(), durations, now);
        let Some(spread) = spread else {
            return;
        };
        self.spreading.open = Some(spread);
        // The field takes what the input method composes.
        self.window.set_ime_allowed(true);
        self.spreading_changed();
    }

    /// The spread opened or closed: covered windows' surfaces show while it is open, so their
    /// cards are live.
    fn spreading_changed(&mut self) {
        let open = self.spreading.open.is_some();
        self.hosted.set_spreading(open);
        let outcome = self.hosted.replan(Instant::now());
        self.carry(outcome);
    }

    /// What the spread makes of `input` while it is open: `None` when it is closed, else whether
    /// it took the event whole.
    pub(super) fn spread_input(&mut self, input: &Input) -> Option<bool> {
        match input {
            Input::Modifiers(mods) => self.spreading.mods = *mods,
            Input::PointerMoved { x, y } => self.spreading.at = Vec2::new(*x, *y),
            _ => {}
        }
        self.spreading.open.as_ref()?;
        let scale = self.window.scale_factor();
        let now = self.hosted.ms(Instant::now());
        let css = |at: Vec2| Vec2::new(at.x, at.y) / scale as f32;
        let taken = match input {
            Input::PointerMoved { x, y } => {
                let at = css(Vec2::new(*x, *y));
                if let Some((from, moved)) = self.spreading.drag {
                    let d = at - from;
                    self.spreading.drag = Some((at, moved + f64::from(d.x.abs() + d.y.abs())));
                    self.with_spread(|s| s.pan(f64::from(d.x), f64::from(d.y), now));
                } else if let Some(id) = self.card_at(Vec2::new(*x, *y)) {
                    self.with_spread(|s| {
                        s.hover(&id, now);
                    });
                }
                true
            }
            Input::PointerButton {
                button: Button::Left,
                pressed,
            } => {
                let device = self.spreading.at;
                self.spread_press(device, *pressed, now);
                true
            }
            Input::PointerButton { .. } | Input::PointerLeft => true,
            Input::Wheel { dx, dy, unit } => {
                let k = match unit {
                    SurfaceWheelUnit::Pixel => 1.0 / scale,
                    SurfaceWheelUnit::Line => LINE,
                    SurfaceWheelUnit::Page => f64::from(self.page.lock().size.1),
                };
                let at = css(self.spreading.at);
                let (x, y) = (f64::from(at.x), f64::from(at.y));
                if self.spreading.mods.ctrl {
                    self.with_spread(|s| s.zoom((-dy * k / 200.0).exp(), x, y, now));
                } else {
                    self.with_spread(|s| s.pan(-dx * k, -dy * k, now));
                }
                true
            }
            Input::Key(key) if key.pressed => self.spread_key(key, now),
            Input::Ime(ImeInput::Commit { text }) => {
                self.spread_typed(|filter| filter.push_str(text), now);
                true
            }
            Input::Ime(_) => true,
            _ => false,
        };
        Some(taken)
    }

    /// A key while the spread is open; whether it took it.
    fn spread_key(&mut self, key: &KeyInput, now: f64) -> bool {
        let mods = self.spreading.mods;
        let press = KeyPress {
            key: key.key.clone(),
            shift: mods.shift,
            meta: mods.meta,
            ctrl: mods.ctrl,
        };
        let action = match self.spreading.open.as_mut() {
            Some(open) => open.key(&press, now),
            None => return false,
        };
        match action {
            SpreadAction::Choose { id } => self.spread_choose(&id, now),
            SpreadAction::Cancel | SpreadAction::Moved => {}
            // A chord is the keymap's: the spread's own key closes it.
            SpreadAction::None if mods.meta || mods.ctrl => return false,
            SpreadAction::None if key.key == "Backspace" => {
                self.spread_typed(
                    |filter| {
                        filter.pop();
                    },
                    now,
                );
            }
            SpreadAction::None => match key.text.as_deref() {
                Some(text) if !text.chars().any(char::is_control) => {
                    self.spread_typed(|filter| filter.push_str(text), now);
                }
                _ => {}
            },
        }
        self.shared.lock().dirty = true;
        true
    }

    fn spread_typed(&mut self, edit: impl FnOnce(&mut String), now: f64) {
        let Some(open) = self.spreading.open.as_mut() else {
            return;
        };
        let mut filter = open.model().filter().to_owned();
        edit(&mut filter);
        open.filter(&filter, now);
        self.shared.lock().dirty = true;
    }

    /// The left button at device point `at`: a card picks on its release over the same card, the
    /// scrim pans and, unmoved, closes.
    fn spread_press(&mut self, at: Vec2, pressed: bool, now: f64) {
        let card = self.card_at(at);
        if pressed {
            self.spreading.pressed = card.clone();
            if card.is_none() && self.on_scrim(at) {
                self.spreading.drag = Some((at / self.window.scale_factor() as f32, 0.0));
            }
            return;
        }
        let drag = self.spreading.drag.take();
        let pressed = self.spreading.pressed.take();
        match (pressed, card, drag) {
            (Some(was), Some(id), _) if was == id => self.spread_choose(&id, now),
            (_, _, Some((_, moved))) if moved < CLICK => self.with_spread(|s| s.cancel(now)),
            _ => {}
        }
    }

    /// Pick window `id`: it comes into sight, and the spread closes back on it.
    fn spread_choose(&mut self, id: &str, now: f64) {
        let outs = self.hosted.wm.reveal(id);
        if !outs.is_empty() && self.emit_wm(outs) {
            let outcome = self.hosted.replan(Instant::now());
            self.carry(outcome);
        }
        let windows = self.spread_windows();
        self.with_spread(|s| s.choose(id, windows, now));
    }

    fn with_spread(&mut self, act: impl FnOnce(&mut Spread)) {
        if let Some(open) = self.spreading.open.as_mut() {
            act(open);
            self.shared.lock().dirty = true;
        }
    }

    /// The window whose card is topmost at device point `at`.
    fn card_at(&self, at: Vec2) -> Option<String> {
        let hit = desk_compositor::hit_test(&self.scene, at)?;
        self.spreading.card(hit.node).map(str::to_owned)
    }

    /// Whether device point `at` is on the empty desk under the spread, not its bar.
    fn on_scrim(&self, at: Vec2) -> bool {
        desk_compositor::hit_test(&self.scene, at).is_none_or(|hit| {
            self.spreading.card(hit.node).is_none() && !self.spreading.bar.contains(&hit.node)
        })
    }

    /// Each frame: the spread follows the desk under it, moves on, and once it has closed lets
    /// go; the window picked takes the focus.
    pub(super) fn spread_tick(&mut self, now: Instant) {
        // Closed, it has nothing to follow: the windows are not gathered at every wake-up (R1).
        if self.spreading.open.is_none() {
            return;
        }
        let ms = self.hosted.ms(now);
        let windows = self.spread_windows();
        let Some(open) = self.spreading.open.as_mut() else {
            return;
        };
        if open.closing().is_none() {
            open.sync(windows, ms);
        }
        let frame = open.frame(ms);
        if frame.moving {
            self.shared.lock().dirty = true;
        }
        let Some(ending) = frame.closed else {
            return;
        };
        self.spreading = Spreading {
            mods: self.spreading.mods,
            at: self.spreading.at,
            ..Spreading::default()
        };
        self.window.set_ime_allowed(self.router.ime_state().0);
        self.spreading_changed();
        self.shared.lock().dirty = true;
        if let Ending::Chosen(id) = ending {
            let run = json!({ "command": FOCUS, "args": { "window": id } });
            self.desk.pages.emit(Role::Main, RUN, run);
        }
    }

    /// The spread's state, for checks (development builds).
    pub fn spread_state(&self) -> Value {
        let Some(open) = &self.spreading.open else {
            return json!({ "open": false });
        };
        let model = open.model();
        let ms = self.hosted.ms(Instant::now());
        let poses = open.frame(ms).poses;
        let shown: Vec<&str> = model.shown().iter().map(|w| w.id.as_str()).collect();
        let asleep: Vec<&str> = (model.windows().iter())
            .filter(|w| w.asleep)
            .map(|w| w.id.as_str())
            .collect();
        json!({ "open": true, "selected": model.selected(), "filter": model.filter(),
            "shown": shown, "windows": model.windows().len(), "asleep": asleep, "flat": model.flat(),
            "closing": open.closing().map(|e| match e {
                Ending::Chosen(id) => json!({ "chosen": id }),
                Ending::Cancelled => json!("cancelled"),
            }),
            "poses": serde_json::to_value(poses).unwrap_or(Value::Null) })
    }
}
