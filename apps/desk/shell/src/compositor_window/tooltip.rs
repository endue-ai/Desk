//! Hover titles in compositor mode (#156): an off-screen page draws no tooltip, so each page's
//! title under the pointer comes to the compositor instead (CEF's `OnTooltip`, `web_host/routes.rs`)
//! and the compositor draws it near the pointer, above everything, in the theme's tooltip look
//! (`tooltip_draw.rs`). It shows once the pointer has rested [`DELAY`] on the surface whose page
//! said it; a move farther than [`SLOP`] puts it away until the pointer rests again; a press or a
//! key puts it away until the pointer, let go, moves farther than [`SLOP`] (as Chromium's own
//! tooltip stays away after a click): not until the page says another title, as the page says the
//! pressed element's late, and a dragged window's page says the titles of its grips and its body as
//! it catches up with the pointer. The wheel, the pointer leaving the window and the window losing
//! the focus put it away too. The desk's page labels some controls itself (the rail's and the
//! arrange strip's `.tooltip`, drawn in the `desk.overlays` part): those carry no `title`, so none
//! is labelled twice.

use std::collections::{BTreeMap, HashMap};
use std::time::{Duration, Instant};

use desk_compositor::glam::Vec2;
use desk_compositor::input::Input;
use serde_json::{Value, json};

use super::CompositorWindow;
use tooltip_draw::Placed;

/// How long the pointer rests before a title shows: Chromium's own tooltip's delay.
pub const DELAY: Duration = Duration::from_millis(500);
/// How far (CSS px) the pointer moves from where a title showed before it goes.
pub const SLOP: f32 = 4.0;
/// The most characters of a title shown, and the most lines: Chromium's own tooltip's.
const MAX_CHARS: usize = 1024;
const MAX_LINES: usize = 16;

/// A title as it is shown: line breaks as `\n`, tabs as spaces, blank ends off, cut to
/// [`MAX_LINES`] lines and [`MAX_CHARS`] characters (`…` where it was cut).
pub fn shown(title: &str) -> String {
    let unified = title.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<String> = (unified.trim().split('\n'))
        .map(|line| line.replace('\t', " ").trim_end().to_owned())
        .collect();
    let mut cut = lines.len() > MAX_LINES;
    lines.truncate(MAX_LINES);
    let mut text = lines.join("\n");
    if let Some((at, _)) = text.char_indices().nth(MAX_CHARS) {
        text.truncate(at);
        cut = true;
    }
    if cut {
        text = format!("{}…", text.trim_end());
    }
    text
}

/// The title showing: whose, what, and where the pointer was then (device px).
#[derive(Clone, Debug, PartialEq)]
pub struct Tip {
    pub surface: String,
    pub text: String,
    pub at: Vec2,
}

/// What the pages said and what the pointer did, and the title that shows.
#[derive(Debug, Default)]
pub struct Tips {
    /// Each surface's title under the pointer now (none when it said `""`).
    titles: HashMap<String, String>,
    /// A press or a key put the titles away: none shows until the pointer, let go, moves farther
    /// than [`SLOP`] from here (device px).
    quiet: Option<Vec2>,
    /// A button is down: no title shows, and the pointer's moves keep them away.
    held: bool,
    /// Where the pointer is (device px) and since when it rests there, or since the title it
    /// rests on came.
    at: Option<Vec2>,
    rest: Option<Instant>,
    shown: Option<Tip>,
    /// When the title waiting for the rest's end shows.
    waiting: Option<Instant>,
    /// Where the title showing is drawn, laid out when it showed.
    pub placed: Option<Placed>,
}

impl Tips {
    /// The page of `surface` shows `title` on hover now (`""`: none); true when what shows changed.
    pub fn said(&mut self, surface: &str, title: &str, now: Instant) -> bool {
        let text = shown(title);
        if text.is_empty() {
            self.titles.remove(surface);
        } else if self.titles.get(surface) != Some(&text) {
            self.titles.insert(surface.to_owned(), text.clone());
            self.rest = self.at.map(|_| now);
        }
        let changed = (self.shown.as_ref()).is_some_and(|t| t.surface == surface && t.text != text);
        changed && self.hide()
    }

    /// The pointer moved to `at` (device px, `scale` of them a CSS px).
    pub fn moved(&mut self, at: Vec2, scale: f32, now: Instant) -> bool {
        self.at = Some(at);
        self.rest = Some(now);
        if !self.held && self.quiet.is_some_and(|q| q.distance(at) > SLOP * scale) {
            self.quiet = None;
        }
        let far = (self.shown.as_ref()).is_some_and(|t| t.at.distance(at) > SLOP * scale);
        far && self.hide()
    }

    /// A button went down (`Some(true)`) or up (`Some(false)`), a key went down (`None`): the
    /// titles stay away until the pointer, let go, moves on.
    pub fn pressed(&mut self, button: Option<bool>, now: Instant) -> bool {
        if let Some(down) = button {
            self.held = down;
        }
        self.quiet = self.at.or(self.quiet);
        self.rest = self.at.map(|_| now);
        self.hide()
    }

    /// The wheel: what shows goes, and the pointer rests anew.
    pub fn wheel(&mut self, now: Instant) -> bool {
        self.rest = self.at.map(|_| now);
        self.hide()
    }

    /// The pointer left the window (a button held stays held: a drag can leave and come back).
    pub fn left(&mut self) -> bool {
        self.at = None;
        self.rest = None;
        self.quiet = None;
        self.hide()
    }

    /// The window lost the focus: no button is held any more, as the window manager drops its
    /// gesture then.
    pub fn blurred(&mut self) -> bool {
        self.held = false;
        self.left()
    }

    /// Surface `surface` left the desk: its title goes with it.
    pub fn forget(&mut self, surface: &str) -> bool {
        self.titles.remove(surface);
        let gone = (self.shown.as_ref()).is_some_and(|t| t.surface == surface);
        gone && self.hide()
    }

    /// Show or put away at `now`: `hearing` are the surfaces the pointer is in, the one it is for
    /// first (the desk's page hears it over every surface too, and says the titles of what lies
    /// under them in its DOM: a window's body is titled with its name). True when what shows
    /// changed.
    pub fn look(&mut self, now: Instant, hearing: &[String]) -> bool {
        self.waiting = None;
        let candidate = (hearing.first())
            .and_then(|s| self.titles.get(s).map(|t| (s.clone(), t.clone())))
            .filter(|_| !self.held && self.quiet.is_none());
        if let Some(tip) = &self.shown {
            let same =
                (candidate.as_ref()).is_some_and(|(s, t)| *s == tip.surface && *t == tip.text);
            return !same && self.hide();
        }
        let (Some((surface, text)), Some(at), Some(rest)) = (candidate, self.at, self.rest) else {
            return false;
        };
        if now < rest + DELAY {
            self.waiting = Some(rest + DELAY);
            return false;
        }
        self.shown = Some(Tip { surface, text, at });
        true
    }

    /// When a title waiting for the pointer's rest shows, for the event loop's next wake-up.
    pub fn due(&self) -> Option<Instant> {
        self.waiting
    }

    pub fn shown(&self) -> Option<&Tip> {
        self.shown.as_ref()
    }

    fn hide(&mut self) -> bool {
        self.placed = None;
        self.shown.take().is_some()
    }

    /// What checks read: each page's title now, and the one showing with its box (CSS px).
    pub fn state(&self, scale: f32) -> Value {
        let titles: BTreeMap<&String, &String> = self.titles.iter().collect();
        let css = |r: desk_compositor::Rect| [r.x, r.y, r.width, r.height].map(|v| v / scale);
        let shown = self.shown.as_ref().map(|t| {
            let rect = self.placed.as_ref().map(|p| css(p.pill));
            json!({ "surface": t.surface, "text": t.text, "rect": rect })
        });
        json!({ "titles": titles, "shown": shown })
    }
}

impl CompositorWindow {
    /// What an input does to the hover title, before anything routes it.
    pub(super) fn tip_input(&mut self, input: &Input) {
        let now = Instant::now();
        let changed = match input {
            Input::PointerMoved { x, y } => {
                let scale = self.window.scale_factor() as f32;
                self.tips.moved(Vec2::new(*x, *y), scale, now)
            }
            Input::PointerButton { pressed, .. } => self.tips.pressed(Some(*pressed), now),
            Input::Key(key) if key.pressed => self.tips.pressed(None, now),
            Input::Wheel { .. } => self.tips.wheel(now),
            Input::PointerLeft => self.tips.left(),
            Input::WindowFocused { focused: false } => self.tips.blurred(),
            _ => false,
        };
        if changed {
            self.shared.lock().dirty = true;
        }
    }

    /// The pages' new titles, then the clock's look: a title shows, laid out in the theme, or goes.
    pub(super) fn tip_tick(&mut self, now: Instant) {
        let said = std::mem::take(&mut self.shared.lock().tips);
        let mut changed = false;
        for (surface, title) in said {
            changed |= self.tips.said(&surface, &title, now);
        }
        let (_, hearing, _) = self.router.pointer_state();
        changed |= self.tips.look(now, hearing);
        if !changed {
            return;
        }
        let scale = self.window.scale_factor() as f32;
        let viewport = self.scene.viewport();
        let mut composed = self.shared.lock();
        let fonts = composed.compositor.fonts();
        let style = &self.theme.tooltip;
        let placed =
            (self.tips.shown()).map(|tip| tooltip_draw::place(fonts, style, tip, scale, viewport));
        self.tips.placed = placed;
        composed.dirty = true;
    }

    /// Draw the title showing over everything the scene holds.
    pub(super) fn tip_draw(&mut self) {
        if let Some(placed) = &self.tips.placed {
            let scale = self.window.scale_factor() as f32;
            tooltip_draw::draw(&mut self.scene, placed, &self.theme.tooltip, scale);
        }
    }
}

#[path = "tooltip_draw.rs"]
mod tooltip_draw;

#[cfg(test)]
#[path = "tooltip_tests.rs"]
mod tests;
