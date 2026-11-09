//! What the person sees, for the brain (ADR 0109, ADR 0124). brain.say may carry the runtime's
//! snapshot of the desk (`BrainDesk`): the screen and every window with the panes each shows, the
//! desktops, the windows closed recently and what the person can do. The core words it once, as the
//! first part of the turn's message, and names each plugin's tools beside its window, so the brain
//! can tell which plugin a request is for ("this", "here", "the window on the left") and hand it to
//! that plugin's commands. The words stay within BUDGET characters: each part has its share and,
//! cut short, ends with a line that names the command listing the rest, so the same desk always
//! gives the same words (desk_context_parts.rs). The person's line follows as its own part.

use desk_brain::{TextPart, UserMessage};
use desk_bridge::{
    BrainDesk, BrainDeskDesktop, BrainDeskPane, BrainDeskResponsiveness, BrainDeskWindow,
};

#[path = "desk_context_parts.rs"]
mod parts;
use parts::{Part, capabilities, closed, elsewhere, what};

/// The most tool names said beside one plugin; desk-tools lists the rest.
const NAMES: usize = 12;
/// The most characters the desk's words take (ADR 0124): about 2,000 tokens.
pub(crate) const BUDGET: usize = 8_192;
/// The screen's share of it; desk_context_parts.rs has the other parts' (the first and the last
/// line take the rest).
const SCREEN: usize = 3_840;

/// What the person said, and the desk they saw as they said it.
#[derive(Clone, Copy)]
pub(crate) struct Line<'a> {
    pub text: &'a str,
    pub desk: Option<&'a BrainDesk>,
}

/// A turn's message: the desk in words (`desk`, when the line came with it), then the line.
pub(crate) fn message(text: &str, desk: Option<String>) -> UserMessage {
    let part = |text: String| TextPart {
        r#type: Default::default(),
        text,
    };
    UserMessage {
        role: Default::default(),
        content: desk
            .into_iter()
            .chain([text.to_owned()])
            .map(part)
            .collect(),
    }
}

/// The desktop in front, with its position from 1, when the snapshot names the desktops.
fn current(desk: &BrainDesk) -> Option<(usize, &BrainDeskDesktop)> {
    let list = desk.desktops.as_deref()?;
    let at = list.iter().position(|d| d.current == Some(true))?;
    Some((at + 1, &list[at]))
}

/// Whether the person sees a window now, or could from the drawer: not one on another desktop.
fn on_screen(window: &BrainDeskWindow, here: Option<&str>) -> bool {
    match (here, window.desktop.as_deref()) {
        (Some(here), Some(desktop)) => window.hidden == Some(true) || here == desktop,
        _ => true,
    }
}

/// The plugins the desk shows, each once: the focused window's first, then the other windows' on
/// screen front to back, then those put away in the drawer, then those on the other desktops.
pub(crate) fn plugins(desk: &BrainDesk) -> Vec<String> {
    let here = current(desk).map(|(_, d)| d.id.as_str());
    let windows = &desk.windows;
    let shown = |w: &&BrainDeskWindow| on_screen(w, here) && w.hidden != Some(true);
    let focused = windows.iter().filter(|w| w.focused == Some(true));
    let hidden = windows.iter().filter(|w| w.hidden == Some(true));
    let elsewhere = windows.iter().filter(|w| !on_screen(w, here));
    let mut out: Vec<String> = Vec::new();
    let all = focused.chain(windows.iter().filter(shown)).chain(hidden);
    for window in all.chain(elsewhere) {
        for plugin in window.panes.iter().filter_map(|p| p.plugin.as_deref()) {
            if !out.iter().any(|seen| seen == plugin) {
                out.push(plugin.to_owned());
            }
        }
    }
    out
}

/// The desk in words: the windows on screen, each where it is and with the tools of each plugin the
/// first time it appears; then the other desktops, the windows closed recently and what the person
/// can do. `tools_of` names a plugin's tools (none when not routed).
pub(crate) fn render(desk: &BrainDesk, tools_of: &dyn Fn(&str) -> Vec<String>) -> String {
    let mut out = String::from(
        "[The desk as the person sees it while saying the line below. Use it to tell which \
         plugin a request is for: \"this\", \"here\" or \"the window on the left\" mean a window \
         listed here, the focused one first. Hand the work to that plugin's tools.]\n",
    );
    out.push_str(&screen(desk, tools_of));
    out.push_str(&elsewhere(desk));
    out.push_str(&closed(desk));
    out.push_str(&capabilities(desk.capabilities.as_ref()));
    out.push_str("[The person says:]\n");
    debug_assert!(
        out.chars().count() <= BUDGET,
        "the parts' shares fit the budget"
    );
    out
}

/// The desktop in front: one line per window and, the first time a plugin appears, its tools.
fn screen(desk: &BrainDesk, tools_of: &dyn Fn(&str) -> Vec<String>) -> String {
    let (sw, sh) = (desk.screen.w, desk.screen.h);
    let here = current(desk);
    let windows: Vec<&BrainDeskWindow> = (desk.windows.iter())
        .filter(|w| on_screen(w, here.map(|(_, d)| d.id.as_str())))
        .collect();
    let mut head = format!("Screen {sw}×{sh}");
    if let Some((at, d)) = here {
        let count = desk.desktops.as_ref().map_or(0, Vec::len);
        head.push_str(&format!(
            ", desktop \"{}\" ({at} of {count}) in front",
            d.name
        ));
    }
    head.push_str(&match windows.len() {
        0 => ", no windows open.".to_owned(),
        n => format!(", {n} window(s), front to back:"),
    });
    let mut part = Part::new(SCREEN, head);
    let mut said: Vec<String> = Vec::new();
    for window in windows {
        let place = (window.hidden != Some(true)).then(|| place(window, sw, sh));
        let mut lines = vec![format!("- {}", line(window, place))];
        let mut new: Vec<String> = Vec::new();
        for plugin in window.panes.iter().filter_map(|p| p.plugin.as_deref()) {
            if said.iter().chain(&new).any(|s| s == plugin) {
                continue;
            }
            new.push(plugin.to_owned());
            let names = tools_of(plugin);
            if names.is_empty() {
                continue;
            }
            let more = names.len().saturating_sub(NAMES);
            let mut listed = names.into_iter().take(NAMES).collect::<Vec<_>>().join(", ");
            if more > 0 {
                listed.push_str(&format!(" and {more} more (desk-tools)"));
            }
            lines.push(format!("  {plugin} tools: {listed}"));
        }
        if part.add(&lines) {
            said.extend(new);
        }
    }
    part.end("desk.windows.list")
}

/// One window: its panes, its state, and where it is (`place`, for one on screen).
fn line(window: &BrainDeskWindow, place: Option<&str>) -> String {
    let panes: Vec<String> = window.panes.iter().map(pane).collect();
    let mut text = format!("{}: {}", window.id, panes.join(" | "));
    let mut flags = Vec::new();
    if window.focused == Some(true) {
        flags.push("focused");
    }
    if window.floating == Some(true) {
        flags.push("floating");
    }
    if window.hidden == Some(true) {
        flags.push("put away in the drawer");
    }
    if !flags.is_empty() {
        text.push_str(&format!(" ({})", flags.join(", ")));
    }
    if let Some(place) = place {
        text.push_str(&format!(", {place}"));
    }
    let (x, y, w, h) = (window.x, window.y, window.w, window.h);
    text.push_str(&format!(", at {x},{y} size {w}×{h}"));
    text
}

/// A pane: its title and plugin, or the view it shows; whether it is in use, and whether its
/// plugin's frame stopped answering (#39), with the command that acts on it.
fn pane(pane: &BrainDeskPane) -> String {
    let mut text = match (pane.title.as_deref(), pane.plugin.as_deref()) {
        (title, Some(plugin)) => what(title, Some(plugin)).unwrap_or_default(),
        (Some(title), None) if !title.is_empty() => format!("{title} [{}]", pane.view),
        _ => pane.view.clone(),
    };
    if pane.focused == Some(true) {
        text.push_str(" [in use]");
    }
    match pane.responsiveness {
        Some(BrainDeskResponsiveness::Late) => {
            text.push_str(" [not responding: desk.frames.wait or desk.frames.stop]");
        }
        Some(BrainDeskResponsiveness::Stopped) => {
            text.push_str(" [stopped: desk.frames.reload]");
        }
        None => {}
    }
    text
}

/// Where on the screen a window's middle is, in words: left, centre or right, and top, middle or
/// bottom; "off screen" when none of it is in sight.
fn place(window: &BrainDeskWindow, sw: u64, sh: u64) -> &'static str {
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

#[cfg(test)]
mod tests {
    use super::*;
    use desk_bridge::BrainDeskSize;

    fn window(id: &str, rect: (i64, i64, u64, u64), plugin: Option<&str>) -> BrainDeskWindow {
        BrainDeskWindow {
            id: id.to_owned(),
            x: rect.0,
            y: rect.1,
            w: rect.2,
            h: rect.3,
            floating: None,
            focused: None,
            hidden: None,
            desktop: None,
            panes: vec![BrainDeskPane {
                view: plugin.map_or("launcher".to_owned(), |p| format!("plugin:{p}")),
                plugin: plugin.map(str::to_owned),
                title: plugin.map(|p| p.trim_start_matches("endue.").to_owned()),
                focused: None,
                responsiveness: None,
            }],
        }
    }

    fn desk(windows: Vec<BrainDeskWindow>) -> BrainDesk {
        BrainDesk {
            screen: BrainDeskSize { w: 1440, h: 900 },
            windows,
            desktops: None,
            closed: None,
            capabilities: None,
        }
    }

    #[test]
    fn the_focused_plugin_comes_first_then_front_to_back_then_the_drawer() {
        let mut mail = window("mail", (0, 0, 400, 300), Some("endue.mail"));
        mail.hidden = Some(true);
        let notes = window("notes", (40, 60, 600, 400), Some("endue.notes"));
        let mut git = window("git", (720, 60, 680, 760), Some("endue.git"));
        git.focused = Some(true);
        let empty = window("window-1", (300, 300, 480, 320), None);
        let plugins = plugins(&desk(vec![mail, notes, empty, git]));
        assert_eq!(plugins, ["endue.git", "endue.notes", "endue.mail"]);
    }

    #[test]
    fn each_window_says_where_it_is_and_each_plugin_its_tools_once() {
        let mut git = window("git", (720, 60, 680, 760), Some("endue.git"));
        git.focused = Some(true);
        git.panes[0].focused = Some(true);
        let mut notes = window("notes", (40, 60, 600, 400), Some("endue.notes"));
        notes.floating = Some(true);
        let again = window("git-2", (2000, 0, 300, 300), Some("endue.git"));
        let mut mail = window("mail", (200, 120, 560, 400), Some("endue.mail"));
        mail.hidden = Some(true);
        let tools = |plugin: &str| match plugin {
            "endue.git" => vec!["endue_git_state".to_owned(), "endue_git_diff".to_owned()],
            "endue.mail" => vec!["endue_mail_latest".to_owned()],
            _ => Vec::new(),
        };
        let text = render(&desk(vec![git, notes, again, mail]), &tools);
        let lines: Vec<&str> = text.lines().collect();
        assert!(lines[0].starts_with("[The desk as the person sees it"));
        assert_eq!(
            &lines[1..],
            [
                "Screen 1440×900, 4 window(s), front to back:",
                "- git: git (endue.git) [in use] (focused), right, at 720,60 size 680×760",
                "  endue.git tools: endue_git_state, endue_git_diff",
                "- notes: notes (endue.notes) (floating), top left, at 40,60 size 600×400",
                "- git-2: git (endue.git), off screen, at 2000,0 size 300×300",
                "- mail: mail (endue.mail) (put away in the drawer), at 200,120 size 560×400",
                "  endue.mail tools: endue_mail_latest",
                "[The person says:]",
            ]
        );
    }

    #[test]
    fn an_empty_desk_says_so_and_a_long_tool_list_points_at_desk_tools() {
        let text = render(&desk(Vec::new()), &|_| Vec::new());
        assert!(text.contains("Screen 1440×900, no windows open.\n"));
        let many = |_: &str| (0..15).map(|n| format!("t{n}")).collect();
        let text = render(&desk(vec![window("a", (0, 0, 10, 10), Some("x.y"))]), &many);
        assert!(text.contains(
            "x.y tools: t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11 and 3 more (desk-tools)\n"
        ));
    }

    #[test]
    fn a_pane_whose_frame_stopped_answering_says_so_and_names_what_acts_on_it() {
        let mut notes = window("notes", (40, 60, 600, 400), Some("endue.notes"));
        notes.panes[0].responsiveness = Some(BrainDeskResponsiveness::Late);
        let mut git = window("git", (720, 60, 680, 760), Some("endue.git"));
        git.panes[0].responsiveness = Some(BrainDeskResponsiveness::Stopped);
        let text = render(&desk(vec![notes, git]), &|_| Vec::new());
        assert!(text.contains(
            "- notes: notes (endue.notes) [not responding: desk.frames.wait or desk.frames.stop], "
        ));
        assert!(text.contains("- git: git (endue.git) [stopped: desk.frames.reload], "));
    }

    #[test]
    fn a_launcher_pane_shows_its_view() {
        let text = render(
            &desk(vec![window("window-1", (500, 300, 480, 320), None)]),
            &|_| Vec::new(),
        );
        assert!(text.contains("- window-1: launcher, centre, at 500,300 size 480×320\n"));
    }

    #[test]
    fn a_window_on_another_desktop_comes_after_those_on_screen_and_says_no_place() {
        let mut git = window("git", (720, 60, 680, 760), Some("endue.git"));
        git.desktop = Some("2".to_owned());
        let mut notes = window("notes", (40, 60, 600, 400), Some("endue.notes"));
        notes.desktop = Some("1".to_owned());
        let mut desk = desk(vec![notes, git]);
        desk.desktops = Some(vec![
            BrainDeskDesktop {
                id: "1".to_owned(),
                name: "Mail".to_owned(),
                current: None,
            },
            BrainDeskDesktop {
                id: "2".to_owned(),
                name: "Code".to_owned(),
                current: Some(true),
            },
        ]);
        assert_eq!(plugins(&desk), ["endue.git", "endue.notes"]);
        let text = render(&desk, &|_| Vec::new());
        assert!(text.contains("desktop \"Code\" (2 of 2) in front, 1 window(s), front to back:\n"));
        assert!(text.contains("- \"Mail\" (desktop 1): notes: notes (endue.notes), at 40,60 "));
    }
}
