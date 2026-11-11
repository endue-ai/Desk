//! A profile switch and the plugin windows in their slots (#158, findings 2 and 6): a tour of the
//! sample profiles ends on the desk it started from, a profile's windows leave with it (from the
//! desktops and from the drawer) instead of waiting in the drawer while their plugins' own windows
//! stay hidden, a plugin's own window moved in the session goes back to its slot, and the next
//! profile's windows open in front of the windows already there, the last one in use. What the
//! session opened and no profile places still waits in the drawer.
//!
//! The profiles are `plugins/shell`'s and `plugins/pack-github`'s samples as the runtime lays them
//! out for the window manager (`savedOf`): only their windows, by desktop.

mod common;

use std::collections::BTreeMap;

use common::*;
use desk_bridge::BrainDeskWindow;
use desk_wm::{Desk, DesktopLayout, FREE, Placement, Saved, Visible, default_placement};

/// The plugins with a window at a fresh start, in mount order (a part of the desk's fourteen).
const PLUGINS: [&str; 7] = [
    "endue.calendar",
    "endue.chat",
    "endue.eris",
    "endue.notes",
    "endue.projects",
    "endue.sidebar",
    "endue.terminal",
];

/// The sample profiles turn the Plugins window's plugin off; Default leaves it on again.
const TURNED_OFF: &str = "endue.sidebar";

/// A profile that lays out `desktops`, each with its windows.
fn profile(desktops: &[(&str, Vec<Placement>)]) -> Saved {
    Saved {
        desktops: desktops
            .iter()
            .map(|(id, surfaces)| ((*id).to_string(), layout(surfaces.clone())))
            .collect::<BTreeMap<_, _>>(),
        ..Saved::default()
    }
}

fn review() -> Saved {
    profile(&[(
        "1",
        vec![
            at("calendar", "endue.calendar", 120.0, 260.0, 520.0, 380.0),
            at("tomorrow", "endue.eris", 980.0, 240.0, 320.0, 360.0),
        ],
    )])
}

fn morning() -> Saved {
    profile(&[
        (
            "2",
            vec![default_placement("calendar"), default_placement("tomorrow")],
        ),
        ("3", vec![default_placement("notes")]),
    ])
}

fn deep_work() -> Saved {
    profile(&[(
        "1",
        vec![at("notes", "endue.notes", 140.0, 220.0, 420.0, 420.0)],
    )])
}

fn studio() -> Saved {
    profile(&[(
        "1",
        vec![at("notes", "endue.notes", 1000.0, 240.0, 340.0, 320.0)],
    )])
}

fn builder_morning() -> Saved {
    profile(&[(
        "1",
        vec![
            at("projects", "endue.projects", 80.0, 120.0, 720.0, 520.0),
            at("github", "desk.universal", 840.0, 120.0, 520.0, 520.0),
        ],
    )])
}

fn night() -> Saved {
    Saved {
        desktop: DesktopLayout {
            rail: Visible { visible: false },
            ..DesktopLayout::default()
        },
        ..Saved::default()
    }
}

/// The desk at a fresh start: Default (the base) in force, the plugins' windows in their slots, the
/// last one in use.
fn fresh() -> Desk {
    let mut desk = sample(EPOCH);
    adopt(&mut desk, &PLUGINS);
    desk.focus_pane("endue.terminal", None);
    desk
}

fn title(id: &str) -> String {
    id.to_string()
}

/// Switch as the runtime does: the profile's plugins on and off around the window manager's switch.
fn switch(desk: &mut Desk, next: Saved, sample: bool, now: i64) {
    if sample {
        desk.release(TURNED_OFF);
    }
    desk.switch_profile(next, title, now);
    if !sample && !desk.holds(TURNED_OFF) {
        desk.adopt(TURNED_OFF, TURNED_OFF, FREE);
    }
}

/// What `desk.windows.list` says of each window, by id, but its rank: where it is, on which
/// desktop, whether it waits in the drawer, what it shows. The ranks follow the focus and the mount
/// order, which a plugin turned off and on again changes.
fn listed(desk: &Desk) -> Vec<String> {
    let place = |w: &BrainDeskWindow| {
        let panes: Vec<&str> = w.panes.iter().map(|p| p.view.as_str()).collect();
        format!(
            "{} d={:?} hidden={:?} [{},{} {}x{}] {panes:?}",
            w.id, w.desktop, w.hidden, w.x, w.y, w.w, w.h
        )
    };
    let mut all: Vec<String> = desk
        .snapshot(1280.0, 800.0)
        .windows
        .iter()
        .map(place)
        .collect();
    all.sort();
    all
}

/// The desktop in front's windows, top first.
fn top_first(desk: &Desk) -> Vec<String> {
    let mut front: Vec<BrainDeskWindow> = (desk.snapshot(1280.0, 800.0).windows.into_iter())
        .filter(|w| w.desktop.as_deref() == Some(desk.here().as_str()))
        .collect();
    front.sort_by_key(|w| std::cmp::Reverse(w.z));
    front.into_iter().map(|w| w.id).collect()
}

mod leaving_a_profile {
    use super::*;

    #[test]
    fn a_tour_of_the_sample_profiles_ends_on_the_desk_it_started_from() {
        let mut desk = fresh();
        let start = listed(&desk);
        let tour = [
            night(),
            review(),
            morning(),
            deep_work(),
            studio(),
            builder_morning(),
        ];
        for (i, next) in tour.into_iter().enumerate() {
            switch(&mut desk, next, true, EPOCH + i as i64);
            assert_eq!(drawer_ids(&desk), drawer_ids(&fresh()), "after switch {i}");
        }
        switch(&mut desk, Saved::default(), false, EPOCH + 10);
        assert_eq!(listed(&desk), start);
    }

    #[test]
    fn gives_each_plugin_its_own_window_back_in_its_slot() {
        let mut desk = fresh();
        let slots: Vec<_> = PLUGINS.iter().map(|id| rect_of(&desk, id)).collect();
        switch(&mut desk, review(), true, EPOCH);
        assert!(desk.window("endue.calendar").is_none());
        switch(&mut desk, Saved::default(), false, EPOCH + 1);
        let back: Vec<_> = PLUGINS.iter().map(|id| rect_of(&desk, id)).collect();
        assert_eq!(back, slots);
        assert!(!drawer_ids(&desk).contains(&"calendar".into()));
    }

    #[test]
    fn takes_its_windows_put_away_with_it_and_lays_them_out_again_when_it_is_back() {
        let mut desk = fresh();
        switch(&mut desk, review(), true, EPOCH);
        desk.put_away("calendar", "Calendar", EPOCH + 1);
        switch(&mut desk, Saved::default(), false, EPOCH + 2);
        assert!(!drawer_ids(&desk).contains(&"calendar".into()));
        assert!(desk.window("endue.calendar").is_some());
        switch(&mut desk, review(), true, EPOCH + 3);
        assert!(desk.window("calendar").is_some());
    }

    #[test]
    fn hands_a_plugin_window_moved_in_the_session_back_to_its_slot() {
        let mut desk = fresh();
        let slot = rect_of(&desk, "endue.terminal");
        desk.move_surface("endue.terminal", desk_wm::Offset::new(700.0, 400.0));
        switch(&mut desk, review(), true, EPOCH);
        assert!(!drawer_ids(&desk).contains(&"endue.terminal".into()));
        assert_eq!(rect_of(&desk, "endue.terminal"), slot);
    }

    #[test]
    fn still_puts_a_window_only_the_session_opened_in_the_drawer() {
        let mut desk = fresh();
        let mine = desk.new_window();
        switch(&mut desk, review(), true, EPOCH);
        assert_eq!(drawer_ids(&desk)[0], mine);
        switch(&mut desk, Saved::default(), false, EPOCH + 1);
        assert_eq!(drawer_ids(&desk)[0], mine);
        assert!(!drawer_ids(&desk).contains(&"calendar".into()));
    }
}

mod the_next_profiles_windows {
    use super::*;

    #[test]
    fn open_in_front_of_the_windows_already_there_the_last_one_in_use() {
        let mut desk = fresh();
        switch(&mut desk, review(), true, EPOCH);
        assert_eq!(top_first(&desk)[..2], ["tomorrow", "calendar"]);
        assert_eq!(desk.focused_window().as_deref(), Some("tomorrow"));
    }

    #[test]
    fn open_in_front_on_another_desktop_too() {
        let mut desk = fresh();
        switch(&mut desk, morning(), true, EPOCH);
        desk.switch_to("2");
        assert_eq!(top_first(&desk)[..2], ["tomorrow", "calendar"]);
    }

    #[test]
    fn leave_the_window_in_use_alone_when_none_is_on_the_desktop_in_front() {
        let mut desk = fresh();
        switch(&mut desk, night(), true, EPOCH);
        assert_eq!(desk.focused_window().as_deref(), Some("endue.terminal"));
    }
}
