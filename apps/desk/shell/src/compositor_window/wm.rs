//! The window manager on the compositor's input (#80, ADR 0153): every pointer event and Escape of
//! the window reach `desk-wm`'s [`desk_wm::interact::Wm`] before the router. The page still finds
//! what a press lands on: a press on a window's grip goes to the page, not to the plugin surface
//! the grip lies over, and the page says with `compositor_grab` that the press starts a move, a
//! resize or a pan; on a window still gliding, which the page lays out where the glide ends, the
//! window manager finds that itself where the window is drawn (#124). The window manager runs the
//! gesture; the runtime hears each change it makes (`desk://compositor-wm`) and takes it as the
//! truth, and the page lays a held window out where it is held (`desk://compositor-held`), so what
//! it draws of the window follows. A card's buttons are the compositor's own: they run
//! `desk.frames.wait`, `stop` and `reload` in the page (`desk://compositor-run`). The desk's window
//! commands come as `compositor_wm`.

use std::sync::mpsc;
use std::time::Instant;

use desk_compositor::NodeId;
use desk_compositor::glam::Vec2;
use desk_compositor::input::{Button, Input};
use desk_web::sender::Role;
use desk_wm::interact::{Kind, Op, Out, grip_at};
use desk_wm::{Point, Told};
use serde_json::{Value, json};

use super::draw::CardButton;
use super::{CompositorWindow, PAGE};

/// The changes the window manager made, for the runtime to take.
pub const WM: &str = "desk://compositor-wm";
/// Where the page lays a held window out.
pub const HELD: &str = "desk://compositor-held";
/// A desk command a card's button runs.
pub const RUN: &str = "desk://compositor-run";
/// How long `desk.windows.list` waits for the page to lay out the desk it names.
const SNAPSHOT_WAIT: std::time::Duration = std::time::Duration::from_secs(1);

/// A call of the page's for the window manager.
#[derive(Debug)]
pub enum Call {
    Grab {
        kind: Kind,
        x: f64,
        y: f64,
    },
    Command {
        op: Op,
        window: Option<String>,
    },
    /// What `desk.windows.list` answers, with what the runtime told of its frames and titles.
    Snapshot {
        told: Told,
        answer: mpsc::Sender<Value>,
    },
}

/// What the shell keeps for the window manager between events.
#[derive(Debug, Default)]
pub struct Gestures {
    /// The page's calls waiting for the edit they follow, by its number.
    deferred: Vec<(u64, Call)>,
    /// The runtime's edits that came ahead of one before them, by number.
    edits: Vec<(u64, Vec<Value>)>,
    /// The number of the last edit applied.
    edited: u64,
    /// `desk.windows.list` asked since, waiting for the page to lay out the desk.
    snapshots: Vec<(Instant, Told, mpsc::Sender<Value>)>,
    /// The cards' buttons as last drawn.
    pub buttons: Vec<CardButton>,
    /// The button a press holds.
    pressed: Option<NodeId>,
    /// An Escape the window manager took: its release goes nowhere either.
    escape: bool,
}

impl CompositorWindow {
    /// What the window manager makes of `input` before the router routes it; whether it took the
    /// event whole (nothing else hears it).
    pub(super) fn wm_input(&mut self, input: &Input) -> bool {
        // The spread, while it is open, and the canvas map hear it first (#54).
        if let Some(taken) = self.spread_input(input) {
            return taken;
        }
        if self.map_input(input) {
            return true;
        }
        let scale = self.window.scale_factor();
        let now = Instant::now();
        let ms = self.hosted.ms(now);
        let css = |at: Vec2| Point::new(f64::from(at.x) / scale, f64::from(at.y) / scale);
        let (outs, taken) = match input {
            Input::PointerMoved { x, y } => {
                let at = css(Vec2::new(*x, *y));
                (self.hosted.wm.moved(at, ms), false)
            }
            Input::PointerButton {
                button: Button::Left,
                pressed,
            } => {
                let device = self.router.pointer_state().2;
                let at = css(device);
                let button = self.button_at(device);
                if *pressed {
                    if button.is_some() {
                        self.gestures.pressed = button;
                        return true;
                    }
                    let grip = self.on_grip(at);
                    if grip {
                        self.router.press_to(PAGE);
                    }
                    // Where the page hears it: a part of a window drawn ahead of the page (a glide)
                    // is the page's where the page lays it out.
                    let under = self.router.targets.surface_at(&self.scene, device);
                    let page = match under {
                        Some((surface, local)) if surface == PAGE && !grip => {
                            Point::new(f64::from(local.x), f64::from(local.y))
                        }
                        _ => at,
                    };
                    // On a window still gliding, desk-wm finds what the press starts where the
                    // window is drawn (#124), its title clear of the top chips as they are drawn.
                    if let Some(top) = self.hosted.report().map(|r| r.top) {
                        self.hosted.wm.set_top_chrome(top);
                    }
                    (self.hosted.wm.pressed_at(at, page), false)
                } else if let Some(held) = self.gestures.pressed.take() {
                    if button == Some(held) {
                        self.run_button(held);
                    }
                    return true;
                } else {
                    (self.hosted.wm.released(at, ms), false)
                }
            }
            Input::Key(key) if key.key == "Escape" => {
                if key.pressed {
                    let (took, outs) = self.hosted.wm.escape();
                    self.gestures.escape = took;
                    (outs, took)
                } else {
                    (Vec::new(), std::mem::take(&mut self.gestures.escape))
                }
            }
            Input::WindowFocused { focused: false } => (self.hosted.wm.cancel(), false),
            _ => return false,
        };
        self.wm_outs(outs, now);
        taken
    }

    /// Whether `at` is on a grip of the window topmost there.
    fn on_grip(&self, at: Point) -> bool {
        let Some(plan) = self.hosted.plan() else {
            return false;
        };
        let inside =
            |r: desk_wm::Rect| at.x >= r.x && at.x < r.right() && at.y >= r.y && at.y < r.bottom();
        (plan.windows.iter().rev())
            .find(|w| inside(w.rect))
            .is_some_and(|w| grip_at(w.rect, at).is_some())
    }

    /// The card's button topmost at device point `at`, if one is.
    fn button_at(&self, at: Vec2) -> Option<NodeId> {
        let hit = desk_compositor::hit_test(&self.scene, at)?;
        (self.gestures.buttons.iter())
            .any(|b| b.node == hit.node)
            .then_some(hit.node)
    }

    fn run_button(&self, node: NodeId) {
        let Some(b) = self.gestures.buttons.iter().find(|b| b.node == node) else {
            return;
        };
        let run = json!({ "command": b.command, "args": { "plugin": b.plugin } });
        self.desk.pages.emit(Role::Main, RUN, run);
    }

    /// A call of the page's that follows its edit numbered `after`: run now if that edit is
    /// applied, else once it is (each call of the page's runs on a thread of its own, so a small
    /// one may overtake the edit it follows).
    pub fn page_call(&mut self, call: Call, after: u64) {
        if self.gestures.edited < after {
            self.gestures.deferred.push((after, call));
            return;
        }
        self.run_call(call);
    }

    /// The runtime's edits numbered `seq` (#83): applied in their order, so one that overtook
    /// another waits for it; then the calls that followed them run. The first is a runtime that
    /// started (the page loaded again): its desk starts afresh.
    pub fn page_edit(&mut self, seq: u64, edits: Vec<Value>) {
        if seq == 1 && self.gestures.edited > 0 {
            self.gestures = Gestures::default();
            self.hosted.wm.reset();
        }
        self.gestures.edits.push((seq, edits));
        self.gestures.edits.sort_by_key(|(seq, _)| *seq);
        let now = Instant::now();
        while let Some(at) =
            (self.gestures.edits.iter()).position(|(seq, _)| *seq <= self.gestures.edited + 1)
        {
            let (seq, edits) = self.gestures.edits.remove(at);
            if seq <= self.gestures.edited {
                continue;
            }
            self.gestures.edited = seq;
            let outs = self.hosted.wm.edit_json(seq, &edits);
            self.wm_outs(outs, now);
        }
        self.run_deferred();
    }

    /// Run the calls that waited for an edit now applied.
    pub(super) fn run_deferred(&mut self) {
        let seq = self.gestures.edited;
        let (ready, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.gestures.deferred)
            .into_iter()
            .partition(|(after, _)| *after <= seq);
        self.gestures.deferred = later;
        for (_, call) in ready {
            self.run_call(call);
        }
        self.answer_snapshots();
    }

    /// Answer the snapshots that waited for the page to lay out the desk they read: what
    /// `desk.windows.list` names is then where the page's parts are too, so a press at a window
    /// it named lands on that window's title bar. One that waited past `SNAPSHOT_WAIT` (a page that
    /// stopped reporting) is answered as the desk is.
    fn answer_snapshots(&mut self) {
        let caught_up = self.hosted.page_took(self.hosted.wm.rev());
        let now = Instant::now();
        let (ready, later): (Vec<_>, Vec<_>) = std::mem::take(&mut self.gestures.snapshots)
            .into_iter()
            .partition(|(since, ..)| caught_up || now.duration_since(*since) >= SNAPSHOT_WAIT);
        self.gestures.snapshots = later;
        let screen = self.hosted.wm.screen();
        for (_, told, answer) in ready {
            let snapshot = self
                .hosted
                .wm
                .desk()
                .snapshot_seen(screen.w, screen.h, &told);
            let _ = answer.send(serde_json::to_value(snapshot).unwrap_or(Value::Null));
        }
    }

    fn run_call(&mut self, call: Call) {
        let now = Instant::now();
        let outs = match call {
            // The page found that the press at `x`, `y` starts `kind`.
            Call::Grab { kind, x, y } => {
                let ms = self.hosted.ms(now);
                self.hosted.wm.grab(kind, Point::new(x, y), ms)
            }
            // The spread is the compositor's to draw: it opens or closes here (#54).
            Call::Command { op: Op::Spread, .. } => {
                self.spread_toggle();
                return;
            }
            // A window command, for window `window` or the one in use.
            Call::Command { op, window } => self.hosted.wm.run(&op, window.as_deref()),
            Call::Snapshot { told, answer } => {
                self.gestures.snapshots.push((now, told, answer));
                self.answer_snapshots();
                return;
            }
        };
        self.wm_outs(outs, now);
    }

    /// Tell the runtime and the page what the window manager calls for; whether something drawn
    /// changed.
    pub(super) fn emit_wm(&self, outs: Vec<Out>) -> bool {
        let mut redraw = false;
        for out in outs {
            match out {
                Out::Publish(published) => {
                    let body = serde_json::to_value(&published).unwrap_or(Value::Null);
                    self.desk.pages.emit(Role::Main, WM, body);
                    redraw = true;
                }
                Out::Held(held) => {
                    let body = match held {
                        Some((window, r)) => json!({ "window": window,
                            "rect": { "x": r.x, "y": r.y, "w": r.w, "h": r.h } }),
                        None => json!({ "window": null }),
                    };
                    self.desk.pages.emit(Role::Main, HELD, body);
                    redraw = true;
                }
                Out::Redraw => redraw = true,
            }
        }
        redraw
    }

    /// The same, then plan and draw again.
    fn wm_outs(&mut self, outs: Vec<Out>, now: Instant) {
        if outs.is_empty() || !self.emit_wm(outs) {
            return;
        }
        let outcome = self.hosted.replan(now);
        self.carry(outcome);
    }

    /// The window manager's state, for checks (development builds).
    pub fn wm_state(&self) -> Value {
        let wm = &self.hosted.wm;
        let preview = (self.hosted.preview())
            .map(|(r, under)| json!({ "rect": [r.x, r.y, r.w, r.h], "under": under }));
        json!({ "held": wm.held(), "holds": wm.holds(), "rev": wm.rev(), "preview": preview,
            "buttons": self.gestures.buttons.len(), "spread": self.spread_state(),
            "map": self.map_state() })
    }
}
