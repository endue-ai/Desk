//! Window ids are unique across desktops (#101), ported from
//! `packages/runtime/src/shell/window-ids.test.ts` case by case: ⌘N's `window-<n>` is the first
//! number no window on any desktop, no window placed but not drawn and no drawer item has. Before,
//! it looked at the desktop in front only, so two desktops could each hold a `window-1`, and the
//! drawer let go of one put away while the other desktop placed its namesake (#4): it vanished.

mod common;

use common::*;
use desk_wm::{Desk, PaneNode, Placement, Rect};

/// Every window id the desk holds: each desktop's windows, then the drawer's.
fn all_ids(c: &Desk) -> Vec<String> {
    let mut ids: Vec<String> = c
        .desktops()
        .iter()
        .flat_map(|d| c.windows_of(d.id.as_str()))
        .map(|p| p.id)
        .collect();
    ids.extend(
        c.drawer
            .iter()
            .filter_map(|d| d.placement.as_ref().map(|p| p.id.clone())),
    );
    ids
}

fn layout_ids(c: &Desk, desktop: &str) -> Vec<String> {
    c.layout_of(desktop)
        .surfaces
        .into_iter()
        .map(|p| p.id)
        .collect()
}

#[test]
fn a_new_window_on_desktop_2_never_takes_an_id_desktop_1_uses() {
    let mut c = sample(EPOCH);
    assert_eq!(c.new_window(), "window-1");
    c.set_desktop("2");
    assert_eq!(c.new_window(), "window-2");
    c.set_desktop("3");
    assert_eq!(c.new_window(), "window-3");
    let mut ids: Vec<String> = all_ids(&c)
        .into_iter()
        .filter(|id| id.starts_with("window-"))
        .collect();
    let all = ids.len();
    ids.sort();
    ids.dedup();
    assert_eq!(ids.len(), all, "no two windows share an id");
}

#[test]
fn a_window_placed_but_not_drawn_keeps_its_id() {
    let mut c = sample(EPOCH);
    let mut gone = Placement::new(
        "window-1",
        "endue.window",
        Rect::new(0.0, 0.0, 480.0, 320.0),
    );
    gone.panes = Some(PaneNode::view("p1", "plugin:p.gone"));
    c.edit(|l| l.surfaces.push(gone));
    assert!(c.window("window-1").is_none(), "its plugin is away");
    c.set_desktop("2");
    assert_eq!(c.new_window(), "window-2");
}

#[test]
fn put_away_on_desktop_2_a_window_stays_in_the_drawer_and_comes_back_on_desktop_1() {
    let mut c = sample(EPOCH);
    let one = c.new_window();
    c.show_in_pane(&one, "p1", "notes");
    c.set_desktop("2");
    let two = c.new_window();
    c.show_in_pane(&two, "p1", "calendar");
    c.put_away(&two, "Calendar", EPOCH + 1000);
    let item = c
        .drawer
        .iter()
        .find(|d| d.placement.as_ref().is_some_and(|p| p.id == two))
        .cloned()
        .expect("in the drawer");
    assert_eq!(
        item.placement.as_ref().map(|p| p.panes()),
        Some(PaneNode::view("p1", "calendar"))
    );
    assert!(layout_ids(&c, "2").is_empty());
    c.set_desktop("1");
    c.bring_back(&item.id);
    assert_eq!(layout_ids(&c, "1"), [one.clone(), two.clone()]);
    let panes: Vec<PaneNode> = c
        .layout_of("1")
        .surfaces
        .iter()
        .map(|p| p.panes())
        .collect();
    assert_eq!(
        panes,
        [
            PaneNode::view("p1", "notes"),
            PaneNode::view("p1", "calendar")
        ]
    );
    assert!(c.drawer.iter().all(|d| d.placement.is_none()));
}

#[test]
fn put_away_on_desktop_1_while_desktop_2_is_in_front_a_new_window_does_not_take_its_id() {
    let mut c = sample(EPOCH);
    let one = c.new_window();
    c.show_in_pane(&one, "p1", "notes");
    c.put_away(&one, "Notes", EPOCH + 1000);
    c.set_desktop("2");
    let two = c.new_window();
    assert_ne!(two, one);
    c.show_in_pane(&two, "p1", "calendar");
    c.bring_back(&format!("surface-{one}"));
    let mut back = layout_ids(&c, "2");
    back.sort();
    let mut want = vec![one, two];
    want.sort();
    assert_eq!(back, want);
}
