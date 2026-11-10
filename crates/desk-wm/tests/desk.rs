//! Ported from the rest of `packages/runtime/src/shell/windows.test.ts` (plugin windows in their
//! slots, closing windows, new windows, plugin windows across desktops), case by case; #78 ported
//! the same file's fills and snaps (`tests/fill.rs`). The TS cases' runtime unmounts a closed
//! window's plugins and takes them out of the handed-over list; here `close_window` answers the
//! plugins to unmount and `release` is the runtime's half.
//!
//! Also the `Desk` state's JSON and its snapshot, what `desk.windows.list` answers (#82), in the
//! contract's type; `tests/scene.rs` checks it against the runtime's on one scene.

mod common;

use std::collections::BTreeMap;

use common::*;
use desk_bridge::{BrainDesk, BrainDeskFill, BrainDeskWindowState};
use desk_wm::{
    Desk, DesktopLayout, Fill, Offset, PaneNode, Placement, Rect, screen_rect, slot_rect,
};
use serde_json::json;

const ORIGIN: Offset = Offset::new(0.0, 0.0);

mod plugin_windows_in_their_slots {
    use super::*;

    #[test]
    fn revealing_a_plugin_focuses_its_own_window_and_leaves_an_empty_launcher_alone() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        let launcher = c.new_window();
        c.show_plugin("p.a");
        assert_eq!(c.focused.as_deref(), Some("p.a"));
        let panes = c
            .windows()
            .into_iter()
            .find(|p| p.id == launcher)
            .map(|p| p.panes());
        assert_eq!(panes, Some(PaneNode::view("p1", "launcher")));
    }

    #[test]
    fn moving_one_leaves_every_other_window_where_it_was_at_its_size() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        let b = rect_of(&c, "p.b");
        let cc = rect_of(&c, "p.c");
        assert_eq!(b, Some(slot_rect(1)));
        c.place("p.a", Rect::new(700.0, 500.0, 300.0, 200.0));
        assert_eq!(
            rect_of(&c, "p.a"),
            Some(Rect::new(700.0, 500.0, 300.0, 200.0))
        );
        assert_eq!(rect_of(&c, "p.b"), b);
        assert_eq!(rect_of(&c, "p.c"), cc);
    }

    #[test]
    fn closing_one_leaves_the_others_where_they_were() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        let cc = rect_of(&c, "p.c");
        let unmount = c.close_window("p.b");
        assert_eq!(unmount, ["p.b"]);
        c.release("p.b");
        assert_eq!(rect_of(&c, "p.b"), None);
        assert_eq!(rect_of(&c, "p.c"), cc);
    }
}

mod closing_a_window {
    use super::*;

    #[test]
    fn takes_a_moved_plugin_window_out_of_the_layout_and_unmounts_the_plugin() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        c.move_surface("p.a", Offset::new(700.0, 500.0));
        assert!(c.layout().surfaces.iter().any(|p| p.id == "p.a"));
        assert_eq!(c.close_window("p.a"), ["p.a"]);
        c.release("p.a");
        assert!(!c.layout().surfaces.iter().any(|p| p.id == "p.a"));
        assert!(!c.windows().iter().any(|p| p.id == "p.a"));
    }

    #[test]
    fn a_placed_window_whose_plugin_went_away_otherwise_is_not_drawn_and_comes_back_with_it() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        c.move_surface("p.a", Offset::new(700.0, 500.0));
        c.release("p.a");
        assert!(!c.windows().iter().any(|p| p.id == "p.a"));
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        let back = rect_of(&c, "p.a").expect("drawn again");
        assert_eq!((back.x, back.y), (700.0, 500.0));
    }

    #[test]
    fn closes_a_shell_views_window_without_unmounting_anything() {
        let mut c = sample(EPOCH);
        c.open_surface("calendar", None);
        assert!(c.close_window("calendar").is_empty());
        assert!(c.layout().surfaces.is_empty());
    }
}

mod normal_and_floating_windows {
    use super::*;

    const PAN: Offset = Offset::new(-500.0, -300.0);

    fn on_screen(c: &Desk, id: &str) -> Option<Rect> {
        let p = c.windows().into_iter().find(|w| w.id == id)?;
        Some(screen_rect(&p, c.pan_of("1"), 1440.0, 900.0))
    }

    #[test]
    fn a_new_window_opens_in_normal_mode_in_sight_of_a_panned_canvas() {
        let mut c = sample(EPOCH);
        c.set(|d| d.pan = BTreeMap::from([("1".into(), PAN)]));
        let id = c.new_window();
        let p = c.layout().surfaces.into_iter().find(|w| w.id == id);
        assert_eq!(p.and_then(|p| p.floating), None);
        let seen = on_screen(&c, &id).expect("drawn");
        assert_eq!((seen.x, seen.y), (480.0, 240.0));
        // Then it moves with the canvas.
        c.set(|d| d.pan = BTreeMap::from([("1".into(), ORIGIN)]));
        let seen = on_screen(&c, &id).expect("drawn");
        assert_eq!((seen.x, seen.y), (980.0, 540.0));
    }

    #[test]
    fn new_windows_take_the_next_free_number_and_cascade_by_32() {
        let mut c = sample(EPOCH);
        let first = c.new_window();
        let second = c.new_window();
        assert_eq!((first.as_str(), second.as_str()), ("window-1", "window-2"));
        let l = c.layout().surfaces;
        assert_eq!((l[1].x - l[0].x, l[1].y - l[0].y), (32.0, 32.0));
        c.put_away("window-1", "Launcher", EPOCH);
        assert_eq!(
            c.new_window(),
            "window-3",
            "one in the drawer keeps its number"
        );
    }
}

mod plugin_windows_across_desktops {
    use super::*;

    #[test]
    fn one_moved_on_a_desktop_lives_there_showing_its_plugin_goes_to_that_desktop() {
        let mut c = sample(EPOCH);
        adopt(&mut c, &["p.a", "p.b", "p.c"]);
        c.move_surface("p.a", Offset::new(700.0, 500.0));
        assert!(!c.windows_of("2").iter().any(|p| p.id == "p.a"));
        // The others, in their slots, are on every desktop until moved.
        assert!(c.windows_of("2").iter().any(|p| p.id == "p.b"));
        c.set(|d| d.desktop = "2".into());
        c.show_plugin("p.a");
        assert_eq!(c.desktop, "1");
        assert_eq!(c.focused.as_deref(), Some("p.a"));
        assert!(!c.layout_of("2").surfaces.iter().any(|p| p.id == "p.a"));
    }
}

/// Two windows on desktop 1 (Notes in use, Mail floating and filling the right half, at a pan),
/// a plugin window in its slot, one put away, one on desktop 2.
fn seen_desk() -> Desk {
    let mut d = sample(EPOCH);
    let mut mail = at("mail", "endue.mail", 0.0, 0.0, 400.0, 300.0);
    mail.floating = Some(true);
    mail.fill = Some(Fill::Right);
    let notes = at("notes", "endue.notes", 300.0, 200.0, 400.0, 300.0);
    d.set(|s| {
        s.session.insert("1".into(), layout(vec![notes, mail]));
        s.session.insert(
            "2".into(),
            layout(vec![at("keys", "endue.keys", 20.0, 30.0, 400.0, 300.0)]),
        );
        s.pan.insert("1".into(), Offset::new(-100.0, 0.0));
    });
    adopt(&mut d, &["p.x"]);
    d.open_surface("files", None);
    d.put_away("files", "Files", EPOCH);
    d.focus_pane("notes", None);
    d
}

mod the_snapshot {
    use super::*;

    #[test]
    fn lists_the_desktop_in_fronts_windows_front_to_back_then_the_drawers_then_the_others() {
        let shot = seen_desk().snapshot(1440.0, 900.0);
        let order: Vec<(&str, Option<&str>)> = shot
            .windows
            .iter()
            .map(|w| (w.id.as_str(), w.desktop.as_deref()))
            .collect();
        // Mail floats above all; Notes is in use; the plugin window in its slot is named once,
        // where it is seen; Files waits in the drawer.
        assert_eq!(
            order,
            [
                ("mail", Some("1")),
                ("notes", Some("1")),
                ("p.x", Some("1")),
                ("files", None),
                ("keys", Some("2")),
            ]
        );
        let desktops = shot.desktops.clone().unwrap_or_default();
        let current: Vec<(&str, Option<bool>)> = desktops
            .iter()
            .map(|d| (d.id.as_str(), d.current))
            .collect();
        assert_eq!(
            current,
            [("1", Some(true)), ("2", None), ("3", None), ("4", None)]
        );
        assert_eq!((shot.screen.w, shot.screen.h), (1440, 900));
    }

    #[test]
    fn tells_each_windows_place_on_screen_its_stacking_its_state_and_its_panes() {
        let shot = seen_desk().snapshot(1440.0, 900.0);
        let by = |id: &str| shot.windows.iter().find(|w| w.id == id).unwrap();
        let notes = by("notes");
        assert_eq!((notes.x, notes.y, notes.w, notes.h), (200, 200, 400, 300));
        assert_eq!(notes.focused, Some(true));
        assert_eq!((notes.floating, notes.hidden), (None, None));
        assert_eq!(notes.state, Some(BrainDeskWindowState::Normal));
        assert_eq!(notes.panes.len(), 1);
        assert_eq!(notes.panes[0].focused, Some(true));
        let mail = by("mail");
        assert_eq!((mail.floating, mail.focused), (Some(true), None));
        assert_eq!(mail.state, Some(BrainDeskWindowState::Snapped));
        assert_eq!(mail.fill, Some(BrainDeskFill::Right));
        assert_eq!((mail.x, mail.y, mail.w, mail.h), (726, 0, 714, 900));
        // Ranks from the back: the plugin window in its slot, then Notes in use, then Mail floating.
        assert_eq!((by("p.x").z, notes.z, mail.z), (Some(0), Some(1), Some(2)));
        let px = by("p.x");
        assert_eq!(px.panes[0].view, "plugin:p.x");
        assert_eq!(px.panes[0].plugin.as_deref(), Some("p.x"));
        assert_eq!(px.panes[0].title.as_deref(), Some("p.x"));
        let files = by("files");
        assert_eq!(files.hidden, Some(true));
        assert_eq!(files.z, None);
        // A window on another desktop is where it is when that desktop comes to the front.
        assert_eq!(
            (by("keys").x, by("keys").y, by("keys").z),
            (20, 30, Some(0))
        );
    }

    #[test]
    fn is_json_in_the_shape_desk_windows_list_answers_and_reads_back() {
        let shot = seen_desk().snapshot(1440.0, 900.0);
        let value = serde_json::to_value(&shot).unwrap();
        assert_eq!(
            value["windows"][1],
            json!({
                "id": "notes", "desktop": "1",
                "x": 200, "y": 200, "w": 400, "h": 300, "z": 1, "state": "normal",
                "focused": true,
                "panes": [{ "id": "p1", "view": "notes", "focused": true }]
            })
        );
        assert_eq!(value["windows"][3]["hidden"], json!(true));
        assert_eq!(
            value["desktops"][0],
            json!({ "id": "1", "name": "1", "current": true, "pan": { "x": -100, "y": 0 } })
        );
        let back: BrainDesk = serde_json::from_value(value).unwrap();
        assert_eq!(back, shot);
    }
}

mod the_desk_state {
    use super::*;

    #[test]
    fn keeps_the_runtimes_json_shapes_and_reads_them_back() {
        let mut d = seen_desk();
        d.move_to_desktop("notes", "2", None);
        let value = serde_json::to_value(&d).unwrap();
        assert_eq!(value["session"]["1"]["eris"], json!(null));
        assert_eq!(value["session"]["1"]["rail"], json!({ "visible": true }));
        assert_eq!(
            value["focusBy"]["2"],
            json!({ "window": "notes", "pane": "p1" })
        );
        assert_eq!(value["drawer"][0]["kind"], json!("surface"));
        assert_eq!(value["drawer"][0]["placement"]["id"], json!("files"));
        assert_eq!(
            value["adopted"][0],
            json!({ "id": "p.x", "title": "p.x", "slot": 0 })
        );
        let back: Desk = serde_json::from_value(value).unwrap();
        assert_eq!(back, d);
    }

    #[test]
    fn reads_a_layout_and_a_drawer_the_web_desk_saved() {
        let layout: DesktopLayout = serde_json::from_value(json!({
            "surfaces": [{ "id": "notes", "plugin": "endue.notes", "x": 140, "y": 260, "w": 380, "h": 300, "pinned": false }],
            "eris": { "x": 600, "y": 40 },
            "rail": { "visible": false },
            "drawer": { "visible": true }
        }))
        .unwrap();
        assert_eq!(layout.eris, Some(Offset::new(600.0, 40.0)));
        assert!(!layout.rail.visible);
        assert_eq!(
            layout.surfaces[0],
            at("notes", "endue.notes", 140.0, 260.0, 380.0, 300.0)
        );
        let item: desk_wm::DrawerItem = serde_json::from_value(json!({
            "id": "recent-weather", "kind": "recent", "name": "Weather this week", "at": 1793170800000_i64
        }))
        .unwrap();
        assert_eq!(item.at, EPOCH - 2 * HOUR);
        assert_eq!(item.placement, None::<Placement>);
    }
}
