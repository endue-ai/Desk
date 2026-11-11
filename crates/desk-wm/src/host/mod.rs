//! The host of windows on the compositor (#81; `packages/runtime/src/surface/host.ts`,
//! `layout.ts`, `edges.ts` and `frames/*`): what the compositor draws for the desktop in front and
//! in which order, from one `Desk` state.
//!
//! - `bars`: the bands the bars float in and the free area between them (ADR 0028, ADR 0132).
//! - `panes`: each window's body under its title bar, split into its panes and dividers.
//! - [`Plan`] (`Desk::host_plan`): every window of the desktop in front back to front, at its
//!   rectangle on screen, with its title, its fill's title clearance, and each pane's box and what
//!   it shows: a plugin's surface, or a view the page draws (the launcher, a sample view); which
//!   plugins are in sight (ADR 0070's cover); and where the page's system layer (bars, Eris,
//!   menus) is drawn above the windows (`page`): the screen without what the page draws of a
//!   window (its title bar's tools, its own views, panes' headers) under another window, which is
//!   drawn at its window's place.
//! - `budget`: the live budget (ADR 0134): who keeps a renderer, who sleeps, who wakes.
//! - `surfaces`: the surfaces made and the lifecycle steps (`specs/surface/v0`) each look calls
//!   for: never a reload for a split, the drawer or a desktop switch (ADR 0040's reload goes).
//!
//! Plain data again: the compositor's shell turns a plan into a scene and the steps into protocol
//! messages; the runtime publishes the state it keeps (ADR 0151, ADR 0156).

mod bars;
mod budget;
mod cut;
mod panes;
mod parts;
mod shown;
mod surfaces;

use std::collections::{BTreeMap, BTreeSet};

pub use bars::{Bars, ERIS_H, ERIS_W, bars};
pub use budget::{Decision, LiveBudget};
pub use cut::{intersect, subtract};
pub use panes::{
    BORDER, Cell, DIVIDER, PANE_HEAD, TITLE, TITLE_END, TITLE_START, body_of, cells, head_of,
    title_bar_of,
};
pub use parts::{PagePart, cut_out, page_parts};
pub use shown::{Laid, PageShown, QUIET_MS};
pub use surfaces::{FrameDoc, FrameState, Seat, Step, Surfaces};

use crate::clearance::{TitleClearance, TopChrome, title_clearance};
use crate::coordinates::{is_floating, screen_rect};
use crate::cover::covered_plugins;
use crate::desk::Desk;
use crate::geometry::screen_area;
use crate::placed::PLUGIN_VIEW;
use crate::snapshot::Seen;
use crate::types::{Fill, Placement, Rect, Size};

/// One pane of a window, on screen.
#[derive(Clone, Debug, PartialEq)]
pub struct HostPane {
    pub id: String,
    /// What it shows, resolved: `plugin:<id>` for a plugin's surface, else the page's view.
    pub view: String,
    /// The plugin whose surface it shows; `None` for a view the page draws.
    pub plugin: Option<String>,
    pub title: String,
    /// Its box in the window.
    pub rect: Rect,
    /// Its header, which the page draws, in a window of more than one pane.
    pub head: Option<Rect>,
    /// What it shows: its box under its header.
    pub body: Rect,
    /// The pane in use, in the window in use.
    pub focused: bool,
}

impl HostWindow {
    /// What the page draws of it, at its place in the stack: its title bar's icon and tools, and
    /// what its panes leave to the page.
    pub fn drawn_by_page(&self) -> Vec<Rect> {
        let mut all = vec![self.title_bar];
        all.extend(self.panes.iter().flat_map(HostPane::drawn_by_page));
        all
    }

    /// Where its title's text goes, which the compositor draws over the page's title bar.
    pub fn title_text(&self) -> Rect {
        let (start, end) = self.title_insets();
        let bar = self.title_bar;
        let x = self.rect.x + start;
        Rect::new(x, bar.y, (self.rect.right() - end - x).max(0.0), bar.h)
    }

    /// From its left and right edges, where its title's text starts and ends: past the icon and
    /// before the tools, both moved in by the top chips' clearance of a fill (ADR 0132).
    pub fn title_insets(&self) -> (f64, f64) {
        title_insets_of(self.clearance)
    }
}

/// The same for a window whose title keeps `clearance`: what the window manager reads of a window
/// it hit-tests where it is drawn (#124).
pub fn title_insets_of(clearance: TitleClearance) -> (f64, f64) {
    let pad = |clear: Option<f64>, own: f64| clear.map_or(own, |c| c.max(own));
    let start = pad(clearance.left, 12.0) - 12.0 + TITLE_START + BORDER;
    let end = pad(clearance.right, 8.0) - 8.0 + TITLE_END + BORDER;
    (start, end)
}

impl HostPane {
    /// What the page draws of it: its header, and the whole of a view of its own.
    pub fn drawn_by_page(&self) -> Vec<Rect> {
        match self.plugin {
            None => vec![self.rect],
            Some(_) => self.head.into_iter().collect(),
        }
    }
}

/// One window of the desktop in front, on screen.
#[derive(Clone, Debug, PartialEq)]
pub struct HostWindow {
    pub id: String,
    pub rect: Rect,
    /// Its stacking level (`cover::z_of`): the focused one on top, windows floating by choice
    /// above the rest, pinned ones above the unpinned, then the order of use.
    pub level: usize,
    pub focused: bool,
    pub pinned: bool,
    pub floating: bool,
    /// The part of the app it fills, a floating window's only.
    pub fill: Option<Fill>,
    /// How far its title keeps clear of the top chips at each end.
    pub clearance: TitleClearance,
    /// The title bar's text: the pane in use's title (the first pane's in a window not in use).
    pub title: String,
    /// Its title bar, whose icon and tools the page draws.
    pub title_bar: Rect,
    pub panes: Vec<HostPane>,
    pub dividers: Vec<Rect>,
    /// Where the page's picture shows it: where it is drawn, unless the window manager moves it
    /// ahead of the page (#80) or the page has not painted where its DOM has it yet (`PageShown`).
    pub page: Rect,
    /// Where the page's DOM lays it out: the page hears the pointer on its parts there.
    pub heard: Rect,
    /// What the page draws of it, from the page to where it is drawn (`parts.rs`).
    pub page_parts: Vec<PagePart>,
}

/// What the compositor draws for the desktop in front, on a `screen`-sized app.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub screen: Size,
    pub bars: Bars,
    /// Back to front.
    pub windows: Vec<HostWindow>,
    /// The plugins in sight: in a window of the desktop in front that is not wholly covered or
    /// off the screen.
    pub shown: BTreeSet<String>,
    /// The plugin with the keys: the one the pane in use shows.
    pub focused_plugin: Option<String>,
    /// Where the page's system layer is drawn above every window: the screen without what the
    /// page draws of a window (`HostWindow::drawn_by_page`) where another window lies over it;
    /// that is drawn with its window, at its place in the stack.
    pub page: Vec<Rect>,
}

impl Plan {
    /// Where plugin `plugin` sits: the frontmost pane showing it, and whether it is in sight.
    pub fn seat(&self, plugin: &str) -> Seat {
        let pane = (self.windows.iter().rev())
            .flat_map(|w| w.panes.iter())
            .find(|p| p.plugin.as_deref() == Some(plugin));
        Seat {
            size: pane.map(|p| (p.body.w, p.body.h)),
            visible: pane.is_some() && self.shown.contains(plugin),
        }
    }

    pub fn window(&self, id: &str) -> Option<&HostWindow> {
        self.windows.iter().find(|w| w.id == id)
    }

    /// Every pane showing plugin `plugin`, back to front.
    pub fn panes_of<'a>(&'a self, plugin: &'a str) -> impl Iterator<Item = &'a HostPane> + 'a {
        (self.windows.iter())
            .flat_map(|w| w.panes.iter())
            .filter(move |p| p.plugin.as_deref() == Some(plugin))
    }
}

/// Where windows are drawn, and shown by the page, other than where their placements put them
/// (#80): a window a gesture holds or that glides, and one the page has not moved yet. By id, on
/// screen.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Places {
    pub drawn: BTreeMap<String, Rect>,
    /// Where the page's picture shows a window, which its parts are taken from (`PageShown`).
    pub page: BTreeMap<String, Rect>,
    /// Where the page's DOM lays a window out, which hears the pointer on its parts, where it is
    /// not where the picture shows it yet.
    pub heard: BTreeMap<String, Rect>,
    /// Windows the page's picture does not show yet: drawn without what the page draws of them.
    pub unpainted: BTreeSet<String>,
    /// What the picture may still show of windows gone from the page: never drawn above the
    /// windows.
    pub stale: Vec<Rect>,
    /// The system layer's parts where the page shows them, drawn whole above every window: what
    /// the page draws of a window leaves them out.
    pub over: Vec<Rect>,
    /// The snap preview and the window it lies under: what the page draws of the windows below
    /// it is drawn with them, under it (#159 finding 19).
    pub preview: Option<(Rect, String)>,
}

impl Desk {
    /// The plan of the desktop in front on a `vw`×`vh` app, the top chips' edges `top` measured
    /// by whoever draws them; `seen` names the page's own views.
    pub fn host_plan(&self, vw: f64, vh: f64, top: TopChrome, seen: &dyn Seen) -> Plan {
        self.host_plan_at(vw, vh, top, seen, &Places::default())
    }

    /// The same with windows drawn or laid out by the page at `places`.
    pub fn host_plan_at(
        &self,
        vw: f64,
        vh: f64,
        top: TopChrome,
        seen: &dyn Seen,
        places: &Places,
    ) -> Plan {
        let here = self.here();
        let pan = self.pan_of(&here);
        let windows = self.windows_of(here.as_str());
        let focused = self.focused.as_deref();
        let levels = self.used.levels(&windows, focused);
        let covered = covered_plugins(&windows, &levels, |p| self.plugins_of(p), pan, vw, vh);
        let mut shown = BTreeSet::new();
        for p in &windows {
            shown.extend(
                self.plugins_of(p)
                    .into_iter()
                    .filter(|id| !covered.contains(id)),
            );
        }
        // Equal levels keep desk order, as the page's stacking does.
        let stack = self.used.stack(&windows, focused);
        let hosted: Vec<HostWindow> = (stack.into_iter())
            .map(|(level, p)| {
                let at = screen_rect(p, pan, vw, vh);
                let drawn = places.drawn.get(&p.id).copied().unwrap_or(at);
                let mut w = self.host_window(p, level, drawn, top, seen);
                let page = places.page.get(&p.id).copied().unwrap_or(at);
                if places.unpainted.contains(&p.id) {
                    w.page_parts.clear();
                } else if page != drawn {
                    let laid = self.host_window(p, level, page, top, seen);
                    w.page = page;
                    w.page_parts = page_parts(&laid, &w);
                }
                w.page_parts = cut_out(&w.page_parts, &places.over);
                w.heard = places.heard.get(&p.id).copied().unwrap_or(w.page);
                w
            })
            .collect();
        // The page is one picture: where it draws part of a window under another (its icons,
        // its views), drawing it again above every window would put that part over the other.
        // Each title's text is the compositor's own, drawn over the page's title bar. A window
        // the page lays out elsewhere than it is drawn leaves all of that place to its window.
        let mut under: Vec<Rect> = hosted.iter().map(HostWindow::title_text).collect();
        under.extend(places.stale.iter().copied());
        // The snap preview is drawn over every window but the one it lies under.
        let preview =
            (places.preview.as_ref()).filter(|(_, by)| hosted.iter().any(|w| &w.id == by));
        for (i, w) in hosted.iter().enumerate() {
            let moved = w.page != w.rect;
            let tinted = preview.filter(|(_, by)| *by != w.id).map(|(r, _)| *r);
            for (part, _) in &w.page_parts {
                if moved {
                    under.push(*part);
                    continue;
                }
                let over = hosted[i + 1..]
                    .iter()
                    .map(|u| u.rect)
                    .chain(tinted)
                    .filter_map(|u| intersect(*part, u));
                under.extend(over);
            }
        }
        Plan {
            screen: Size { w: vw, h: vh },
            bars: bars(vw, vh, &self.layout()),
            windows: hosted,
            shown,
            focused_plugin: self.focused_plugin(),
            page: subtract(screen_area(vw, vh), &under),
        }
    }

    fn host_window(
        &self,
        p: &Placement,
        level: usize,
        rect: Rect,
        top: TopChrome,
        seen: &dyn Seen,
    ) -> HostWindow {
        let focused = self.focused.as_deref() == Some(p.id.as_str());
        let floating = is_floating(p);
        let fill = p.fill.filter(|_| floating);
        let tree = p.panes();
        let leaves = tree.leaves();
        let in_use = focused
            .then(|| {
                (leaves
                    .iter()
                    .find(|(id, _)| Some(*id) == self.pane.as_deref()))
                .or(leaves.first())
                .map(|(id, _)| id.to_string())
            })
            .flatten();
        let many = leaves.len() > 1;
        let mut panes = Vec::new();
        let mut dividers = Vec::new();
        for cell in cells(&tree, body_of(rect)) {
            match cell {
                Cell::Pane { id, view, rect } => {
                    let resolved = self.resolve(p, &view);
                    let plugin = resolved.strip_prefix(PLUGIN_VIEW).map(String::from);
                    let title = match &plugin {
                        Some(plugin) => (self.adopted.iter().find(|a| &a.id == plugin))
                            .map_or_else(|| plugin.clone(), |a| a.title.clone()),
                        None => seen.title(&view).unwrap_or_else(|| view.clone()),
                    };
                    let focused = in_use.as_deref() == Some(id.as_str());
                    let (head, body) = head_of(rect, many);
                    panes.push(HostPane {
                        id,
                        view: resolved,
                        plugin,
                        title,
                        rect,
                        head,
                        body,
                        focused,
                    });
                }
                Cell::Divider { rect, .. } => dividers.push(rect),
            }
        }
        let title = (panes.iter().find(|pane| pane.focused))
            .or(panes.first())
            .map_or_else(|| p.id.clone(), |pane| pane.title.clone());
        let mut w = HostWindow {
            id: p.id.clone(),
            rect,
            level,
            focused,
            pinned: p.pinned,
            floating,
            fill,
            clearance: title_clearance(fill, top),
            title,
            title_bar: title_bar_of(rect),
            panes,
            dividers,
            page: rect,
            heard: rect,
            page_parts: Vec::new(),
        };
        w.page_parts = parts::in_place(&w);
        w
    }
}
