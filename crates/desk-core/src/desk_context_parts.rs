//! The desk in words past the screen (ADR 0124): the windows on the other desktops, the windows
//! closed recently and what the person can do, each part within its share of the budget. A part
//! cut short ends with a line that says how many items were left out and which command lists
//! them, so the same desk always gives the same words. Also two words of a window's line: how it
//! is placed (floating, snapped to a half or a quarter, filling the screen; #82) and where on the
//! screen it is.

use desk_bridge::{
    BrainDesk, BrainDeskCapabilities, BrainDeskClosed, BrainDeskFill, BrainDeskWindow,
    BrainDeskWindowState,
};

use super::{current, line};

/// Each part's share of the budget, in the order they are said after the screen's.
const DESKTOPS: usize = 1_536;
const CLOSED: usize = 1_024;
const CAPABILITIES: usize = 1_280;
/// The most characters of one line, and the room a part keeps for its line about what was cut.
const LINE: usize = 480;
const MORE: usize = 64;

/// The lines of one part within its share: once an item does not fit, it and every later one are
/// cut, and the part ends with a line that says how many and which command lists them.
pub(super) struct Part {
    text: String,
    used: usize,
    room: usize,
    cut: usize,
}

impl Part {
    pub(super) fn new(room: usize, head: String) -> Self {
        let mut part = Part {
            text: String::new(),
            used: 0,
            room,
            cut: 0,
        };
        part.push(&head);
        part
    }

    fn push(&mut self, line: &str) {
        let line = clip(line);
        self.used += line.chars().count() + 1;
        self.text.push_str(&line);
        self.text.push('\n');
    }

    /// Add one item (a window and its tools, say) as its lines, or count it as cut.
    pub(super) fn add(&mut self, lines: &[String]) -> bool {
        let size: usize = lines.iter().map(|l| clip(l).chars().count() + 1).sum();
        if self.cut > 0 || self.used + size + MORE > self.room {
            self.cut += 1;
            return false;
        }
        lines.iter().for_each(|line| self.push(line));
        true
    }

    pub(super) fn end(mut self, command: &str) -> String {
        if self.cut > 0 {
            self.push(&format!("- … and {} more ({command})", self.cut));
        }
        self.text
    }
}

fn clip(line: &str) -> String {
    if line.chars().count() <= LINE {
        return line.to_owned();
    }
    line.chars().take(LINE - 1).chain(['…']).collect()
}

/// What a window shows, for people: its title and plugin, or either.
pub(super) fn what(title: Option<&str>, plugin: Option<&str>) -> Option<String> {
    match (title.filter(|t| !t.is_empty()), plugin) {
        (Some(title), Some(plugin)) => Some(format!("{title} ({plugin})")),
        (None, Some(plugin)) => Some(plugin.to_owned()),
        (Some(title), None) => Some(title.to_owned()),
        (None, None) => None,
    }
}

/// A desktop's name, and its position from 1 when the snapshot lists it.
fn desktop_name(desk: &BrainDesk, id: &str) -> (String, Option<usize>) {
    let list = desk.desktops.as_deref().unwrap_or_default();
    match list.iter().position(|d| d.id == id) {
        Some(at) => (list[at].name.clone(), Some(at + 1)),
        None => (id.to_owned(), None),
    }
}

/// The windows on the other desktops, desktop by desktop in their order; one with none says so.
pub(super) fn elsewhere(desk: &BrainDesk) -> String {
    let Some((_, front)) = current(desk) else {
        return String::new();
    };
    let mut ids: Vec<&str> = desk
        .desktops
        .iter()
        .flatten()
        .map(|d| d.id.as_str())
        .collect();
    for window in &desk.windows {
        if let Some(id) = window.desktop.as_deref().filter(|id| !ids.contains(id)) {
            ids.push(id);
        }
    }
    ids.retain(|id| *id != front.id);
    if ids.is_empty() {
        return String::new();
    }
    let mut part = Part::new(DESKTOPS, "On the other desktops:".to_owned());
    for id in ids {
        let label = match desktop_name(desk, id) {
            (name, Some(at)) => format!("- \"{name}\" (desktop {at}): "),
            (name, None) => format!("- \"{name}\": "),
        };
        let on: Vec<&BrainDeskWindow> = (desk.windows.iter())
            .filter(|w| w.hidden != Some(true) && w.out.is_none())
            .filter(|w| w.desktop.as_deref() == Some(id))
            .collect();
        if on.is_empty() {
            part.add(&[format!("{label}no windows")]);
        }
        for window in on {
            part.add(&[format!("{label}{}", line(window, None))]);
        }
    }
    part.end("desk.windows.list")
}

/// The windows closed recently, the last first.
pub(super) fn closed(desk: &BrainDesk) -> String {
    let closed = desk.closed.as_deref().unwrap_or_default();
    if closed.is_empty() {
        return String::new();
    }
    let head =
        "Closed recently, the last first (desk.windows.reopen brings one back where it was):";
    let mut part = Part::new(CLOSED, head.to_owned());
    for window in closed {
        part.add(&[format!("- {}", closed_line(desk, window))]);
    }
    part.end("desk.windows.closed")
}

fn closed_line(desk: &BrainDesk, window: &BrainDeskClosed) -> String {
    let mut text = match what(window.title.as_deref(), window.plugin.as_deref()) {
        Some(what) => format!("{}: {what}", window.id),
        None => window.id.clone(),
    };
    if window.floating == Some(true) {
        text.push_str(", floating");
    }
    if let Some(id) = window.desktop.as_deref() {
        text.push_str(&format!(", on \"{}\"", desktop_name(desk, id).0));
    }
    let (x, y, w, h) = (window.x, window.y, window.w, window.h);
    text.push_str(&format!(
        ", at {x},{y} size {w}×{h}, closed {}",
        window.closed_at
    ));
    text
}

/// What the person can do, in short: the counts, then the plugins that are on.
pub(super) fn capabilities(summary: Option<&BrainDeskCapabilities>) -> String {
    let Some(c) = summary else {
        return String::new();
    };
    let mut head = format!(
        "What the person can do: {} commands, {} available now",
        c.commands, c.available
    );
    if let Some(keyed) = c.keyed {
        head.push_str(&format!(", {keyed} with keys"));
    }
    head.push_str(
        " (desk.capabilities lists each with its title, owner, keys and whether it is available \
         now).",
    );
    if !c.plugins.is_empty() {
        head.push_str(" Plugins that are on:");
    }
    let mut part = Part::new(CAPABILITIES, head);
    for plugin in &c.plugins {
        let name = match plugin.title.as_deref().filter(|t| !t.is_empty()) {
            Some(title) => format!("{title} ({})", plugin.id),
            None => plugin.id.clone(),
        };
        let (n, a) = (plugin.commands, plugin.available);
        let mut text = format!("- {name}: {n} command{}", if n == 1 { "" } else { "s" });
        if a == 0 && n > 0 {
            text.push_str(", none available now");
        } else if a < n {
            text.push_str(&format!(", {a} available now"));
        }
        if plugin.open == Some(true) {
            text.push_str(", window open");
        }
        part.add(&[text]);
    }
    part.end("desk.capabilities")
}

/// How a window is placed, in words: nothing for a normal one; a runtime before #82 says only
/// whether it floats.
pub(super) fn placed(window: &BrainDeskWindow) -> Option<String> {
    let part = |fill: Option<BrainDeskFill>| match fill {
        Some(BrainDeskFill::Left) => "the left half",
        Some(BrainDeskFill::Right) => "the right half",
        Some(BrainDeskFill::Top) => "the top half",
        Some(BrainDeskFill::Bottom) => "the bottom half",
        Some(BrainDeskFill::TopLeft) => "the top left quarter",
        Some(BrainDeskFill::TopRight) => "the top right quarter",
        Some(BrainDeskFill::BottomLeft) => "the bottom left quarter",
        Some(BrainDeskFill::BottomRight) => "the bottom right quarter",
        Some(BrainDeskFill::Full) | None => "a part of the screen",
    };
    match window.state {
        Some(BrainDeskWindowState::Normal) => None,
        Some(BrainDeskWindowState::Floating) => Some("floating".to_owned()),
        Some(BrainDeskWindowState::Snapped) => Some(format!("snapped to {}", part(window.fill))),
        Some(BrainDeskWindowState::Filled) => Some("filling the screen".to_owned()),
        None => (window.floating == Some(true)).then(|| "floating".to_owned()),
    }
}

/// Where on the screen a window's middle is, in words: left, centre or right, and top, middle or
/// bottom; "off screen" when none of it is in sight.
pub(super) fn place(window: &BrainDeskWindow, sw: u64, sh: u64) -> &'static str {
    let (sw, sh) = (to_i64(sw), to_i64(sh));
    let (w, h) = (to_i64(window.w), to_i64(window.h));
    let outside = window.x >= sw || window.y >= sh || window.x + w <= 0 || window.y + h <= 0;
    if sw == 0 || sh == 0 || outside {
        return "off screen";
    }
    let third = |at: i64, size: i64| match at * 3 / size {
        i64::MIN..=0 => 0,
        1 => 1,
        _ => 2,
    };
    let column = third(window.x + w / 2, sw);
    let row = third(window.y + h / 2, sh);
    const PLACES: [[&str; 3]; 3] = [
        ["top left", "top centre", "top right"],
        ["left", "centre", "right"],
        ["bottom left", "bottom centre", "bottom right"],
    ];
    PLACES[row][column]
}

fn to_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}
