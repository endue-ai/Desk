//! The desk as the window manager sees it: what `desk.windows.list` answers (#82), in the
//! contract's own type (`BrainDesk`, `specs/bridge/v0/brain.schema.json`), as `deskSnapshot` in
//! `packages/runtime/src/shell/desk-view.ts` answers it from the DOM's store. Every window, those
//! of the desktop in front first, front to back, then those put away in the drawer, then those of
//! the other desktops in their order. Each says where it is on screen in whole CSS pixels (a window
//! on another desktop: where it is when that desktop comes to the front; one in the drawer: where
//! it comes back), its rank in its desktop's stacking order (0 at the back), how it is placed
//! (normal, floating, snapped, filled), whether it is pinned or in use, its desktop and its panes.
//! A plugin window in its slot is on every desktop until it is moved (ADR 0117): it is named once,
//! where it is seen. The desktops carry their pans.
//!
//! What the window manager does not hold comes through [`Seen`]: the shell's titles for its own
//! views and how each plugin's frame is doing. The windows closed recently and the capabilities are
//! the command's to add; the contract's limits (64 windows, 16 panes, the strings' lengths) hold
//! here. `tests/scene.rs` and the runtime's `desk-view.scene.test.ts` build one scene and both
//! must equal the contract's vector `desk-windows-list-scene.json`.

use std::collections::BTreeMap;

use desk_bridge::{
    BrainDesk, BrainDeskDesktop, BrainDeskFill, BrainDeskOffset, BrainDeskPane,
    BrainDeskResponsiveness, BrainDeskSize, BrainDeskWindow, BrainDeskWindowState,
};
use serde::{Deserialize, Serialize};

use crate::coordinates::{is_floating, screen_rect};
use crate::cover::z_of;
use crate::desk::Desk;
use crate::math::round;
use crate::placed::PLUGIN_VIEW;
use crate::types::{Fill, Offset, Placement};

/// The contract's limits (`BrainDesk`).
const WINDOWS: usize = 64;
const DESKTOPS: usize = 32;
const PANES: usize = 16;
const ID: usize = 128;
const DESKTOP_ID: usize = 64;
const PANE_ID: usize = 64;
const NAME: usize = 40;
const TITLE: usize = 200;
const VIEW: usize = 256;

/// How a plugin's frame is doing, as the runtime knows it (ADR 0134, #39).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Frame {
    /// Loaded and answering.
    #[default]
    Live,
    /// Put to sleep by the live budget, its state kept.
    Asleep,
    /// Loaded but not answering for 5 s: Not responding.
    Late,
    /// Stopped by the person; it waits for Reload.
    Stopped,
}

/// What a snapshot reads beyond the window manager's state.
pub trait Seen {
    /// The title of one of the shell's own views (`launcher`, `calendar`, ...), when it has one.
    fn title(&self, view: &str) -> Option<String> {
        let _ = view;
        None
    }

    /// How plugin `id`'s frame is doing.
    fn frame(&self, plugin: &str) -> Frame {
        let _ = plugin;
        Frame::Live
    }
}

/// Nothing beyond the state: no titles for the shell's views, every frame live.
pub struct Unseen;

impl Seen for Unseen {}

/// What the runtime tells a snapshot: the titles of the shell's own views and each plugin frame's
/// state, by plugin (one not named is live).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Told {
    #[serde(default)]
    pub titles: BTreeMap<String, String>,
    #[serde(default)]
    pub frames: BTreeMap<String, Frame>,
}

impl Seen for Told {
    fn title(&self, view: &str) -> Option<String> {
        self.titles.get(view).cloned()
    }

    fn frame(&self, plugin: &str) -> Frame {
        self.frames.get(plugin).copied().unwrap_or_default()
    }
}

/// Where a window is listed: on a desktop at its rank, or in the drawer.
#[derive(Clone, Copy)]
struct Seat<'a> {
    desktop: Option<&'a str>,
    z: Option<u64>,
    pan: Offset,
}

/// A whole number of pixels, as the runtime's `int` gives it: JS rounding, 0 for what is not finite.
fn int(v: f64) -> i64 {
    if v.is_finite() { round(v) as i64 } else { 0 }
}

/// A whole size: never below 0.
fn size(v: f64) -> u64 {
    u64::try_from(int(v)).unwrap_or(0)
}

fn cut(text: &str, at: usize) -> String {
    text.chars().take(at).collect()
}

/// A plugin id as the plugin spec writes it (`PluginId`): dotted lower-case words.
fn is_plugin_id(id: &str) -> bool {
    let parts: Vec<&str> = id.split('.').collect();
    parts.len() >= 2
        && parts.iter().all(|part| {
            let mut chars = part.chars();
            chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

fn fill_of(fill: Fill) -> BrainDeskFill {
    match fill {
        Fill::Full => BrainDeskFill::Full,
        Fill::Left => BrainDeskFill::Left,
        Fill::Right => BrainDeskFill::Right,
        Fill::Top => BrainDeskFill::Top,
        Fill::Bottom => BrainDeskFill::Bottom,
        Fill::TopLeft => BrainDeskFill::TopLeft,
        Fill::TopRight => BrainDeskFill::TopRight,
        Fill::BottomLeft => BrainDeskFill::BottomLeft,
        Fill::BottomRight => BrainDeskFill::BottomRight,
    }
}

/// How a window is placed: a fill counts only on a floating window, the one it is drawn by.
fn state_of(p: &Placement) -> (BrainDeskWindowState, Option<BrainDeskFill>) {
    if !is_floating(p) {
        return (BrainDeskWindowState::Normal, None);
    }
    match p.fill {
        Some(Fill::Full) => (BrainDeskWindowState::Filled, Some(BrainDeskFill::Full)),
        Some(fill) => (BrainDeskWindowState::Snapped, Some(fill_of(fill))),
        None => (BrainDeskWindowState::Floating, None),
    }
}

fn yes(b: bool) -> Option<bool> {
    b.then_some(true)
}

impl Desk {
    /// A desktop's windows front to back, each with its rank from the back; the focus counts only
    /// on the desktop in front.
    fn stack(&self, desktop: &str) -> Vec<(Placement, u64)> {
        let focused = (desktop == self.here())
            .then_some(self.focused.as_deref())
            .flatten();
        let mut all: Vec<(Placement, usize)> = self
            .windows_of(desktop)
            .into_iter()
            .enumerate()
            .map(|(i, p)| {
                let level = z_of(&p, i, focused);
                (p, level)
            })
            .collect();
        // Stable, as the runtime's sort is: equal levels keep desk order.
        all.sort_by_key(|a| std::cmp::Reverse(a.1));
        let n = all.len() as u64;
        (all.into_iter().enumerate())
            .map(|(i, (p, _))| (p, n - 1 - i as u64))
            .collect()
    }

    fn pane_snapshot(
        &self,
        p: &Placement,
        (id, view): (&str, &str),
        in_use: Option<&str>,
        seen: &dyn Seen,
    ) -> BrainDeskPane {
        let resolved = self.resolve(p, view);
        let plugin = resolved
            .strip_prefix(PLUGIN_VIEW)
            .filter(|id| is_plugin_id(id))
            .map(String::from);
        let title = match &plugin {
            Some(plugin) => Some(
                (self.adopted.iter().find(|a| &a.id == plugin))
                    .map_or_else(|| plugin.clone(), |a| a.title.clone()),
            ),
            None => seen.title(view),
        };
        let frame = plugin.as_deref().map_or(Frame::Live, |id| seen.frame(id));
        BrainDeskPane {
            id: (!id.is_empty()).then(|| cut(id, PANE_ID)),
            view: cut(&resolved, VIEW),
            plugin,
            title: title.filter(|t| !t.is_empty()).map(|t| cut(&t, TITLE)),
            focused: yes(Some(id) == in_use),
            asleep: yes(frame == Frame::Asleep),
            responsiveness: match frame {
                Frame::Late => Some(BrainDeskResponsiveness::Late),
                Frame::Stopped => Some(BrainDeskResponsiveness::Stopped),
                Frame::Live | Frame::Asleep => None,
            },
        }
    }

    fn window_snapshot(
        &self,
        p: &Placement,
        seat: Seat,
        vw: f64,
        vh: f64,
        seen: &dyn Seen,
    ) -> BrainDeskWindow {
        let rect = screen_rect(p, seat.pan, vw, vh);
        let focused = seat.desktop == Some(self.here().as_str())
            && self.focused.as_deref() == Some(p.id.as_str());
        let tree = p.panes();
        let leaves: Vec<(&str, &str)> = tree.leaves().into_iter().take(PANES).collect();
        let in_use = focused
            .then(|| {
                (leaves
                    .iter()
                    .find(|(id, _)| Some(*id) == self.pane.as_deref()))
                .or(leaves.first())
                .map(|(id, _)| *id)
            })
            .flatten();
        let mut panes: Vec<BrainDeskPane> = (leaves.iter())
            .map(|&leaf| self.pane_snapshot(p, leaf, in_use, seen))
            .collect();
        if panes.is_empty() {
            panes.push(BrainDeskPane {
                id: None,
                view: cut(&p.id, VIEW),
                plugin: None,
                title: None,
                focused: None,
                asleep: None,
                responsiveness: None,
            });
        }
        let (state, fill) = state_of(p);
        BrainDeskWindow {
            id: cut(&p.id, ID),
            x: int(rect.x),
            y: int(rect.y),
            w: size(rect.w),
            h: size(rect.h),
            z: seat.z,
            state: Some(state),
            fill,
            floating: yes(is_floating(p)),
            pinned: yes(p.pinned),
            focused: yes(focused),
            hidden: yes(seat.desktop.is_none()),
            desktop: seat.desktop.map(|d| cut(d, DESKTOP_ID)),
            panes,
        }
    }

    /// The desk now on a `vw`×`vh` app, with nothing known beyond the state ([`Unseen`]).
    pub fn snapshot(&self, vw: f64, vh: f64) -> BrainDesk {
        self.snapshot_seen(vw, vh, &Unseen)
    }

    /// The desk now on a `vw`×`vh` app: what `desk.windows.list` answers, the shell's titles and
    /// the frames' states read from `seen`.
    pub fn snapshot_seen(&self, vw: f64, vh: f64, seen: &dyn Seen) -> BrainDesk {
        fn on<'a>(desk: &Desk, desktop: &'a str, z: u64) -> Seat<'a> {
            Seat {
                desktop: Some(desktop),
                z: Some(z),
                pan: desk.pan_of(desktop),
            }
        }
        let here = self.here();
        let front = self.stack(&here);
        let mut windows: Vec<BrainDeskWindow> = (front.iter())
            .map(|(p, z)| self.window_snapshot(p, on(self, &here, *z), vw, vh, seen))
            .collect();
        let away = Seat {
            desktop: None,
            z: None,
            pan: self.pan_of(&here),
        };
        windows.extend(self.drawer.iter().filter_map(|d| {
            let p = d.placement.as_ref()?;
            Some(self.window_snapshot(p, away, vw, vh, seen))
        }));
        let listed: Vec<&str> = front.iter().map(|(p, _)| p.id.as_str()).collect();
        for d in self.desktops().iter().filter(|d| d.id != here) {
            let placed = self.layout_of(d.id.as_str()).surfaces;
            for (p, z) in self.stack(&d.id) {
                if placed.iter().any(|q| q.id == p.id) || !listed.contains(&p.id.as_str()) {
                    windows.push(self.window_snapshot(&p, on(self, &d.id, z), vw, vh, seen));
                }
            }
        }
        windows.truncate(WINDOWS);
        let desktops = (self.desktops().iter().take(DESKTOPS))
            .map(|d| {
                let pan = self.pan_of(&d.id);
                let name = if d.name.is_empty() { &d.id } else { &d.name };
                BrainDeskDesktop {
                    id: cut(&d.id, DESKTOP_ID),
                    name: cut(name, NAME),
                    current: yes(d.id == here),
                    pan: Some(BrainDeskOffset {
                        x: int(pan.x),
                        y: int(pan.y),
                    }),
                }
            })
            .collect();
        BrainDesk {
            screen: BrainDeskSize {
                w: size(vw),
                h: size(vh),
            },
            windows,
            desktops: Some(desktops),
            closed: None,
            capabilities: None,
        }
    }
}
