//! Windows out of the canvas (#235, ADR 0205): a window pops out into an OS window of its own and
//! docks back. It keeps its id, its desktop and its canvas place; it is on no canvas while out (no
//! drawing, no tile or cascade, no canvas map) but stays in the plan's out list, in sight for the
//! live budget and seated at its OS window's size; it closes from any desktop; and the window
//! commands that do it publish the desk.

mod common;

use common::*;
use desk_wm::interact::{Op, Out, Wm};
use desk_wm::{ArrangeKind, Arranger, Desk, Rect, Size, TopChrome, Unseen};

const W: f64 = 1440.0;
const H: f64 = 900.0;

/// Terminal and Notes, two plugin windows held by the runtime, on desktop 1's canvas.
fn desk() -> Desk {
    let mut desk = Desk::default();
    adopt(&mut desk, &["endue.terminal", "endue.notes"]);
    desk.place("endue.terminal", Rect::new(100.0, 100.0, 500.0, 300.0));
    desk.place("endue.notes", Rect::new(700.0, 100.0, 400.0, 300.0));
    desk
}

const OS: Rect = Rect::new(1200.0, 400.0, 720.0, 450.0);

#[test]
fn a_window_out_is_on_no_canvas_and_keeps_its_place_for_the_dock() {
    let mut desk = desk();
    assert!(desk.pop_out("endue.terminal", OS));
    assert_eq!(ids(&desk.windows()), vec!["endue.notes".to_owned()]);
    let (desktop, out) = desk.out_window("endue.terminal").expect("out");
    assert_eq!(desktop, "1");
    assert_eq!(out.out, Some(OS));
    assert_eq!(out.rect(), Rect::new(100.0, 100.0, 500.0, 300.0));
    // Its frame follows the OS window; a window not out has none to follow.
    let moved = Rect::new(1300.0, 420.0, 800.0, 500.0);
    assert!(desk.set_out_frame("endue.terminal", moved));
    assert!(!desk.set_out_frame("endue.notes", moved));
    assert_eq!(
        desk.out_window("endue.terminal").unwrap().1.out,
        Some(moved)
    );
    // Docked, it is back where it was, in use.
    assert!(desk.dock("endue.terminal"));
    assert_eq!(
        rect_of(&desk, "endue.terminal"),
        Some(Rect::new(100.0, 100.0, 500.0, 300.0))
    );
    assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
    assert!(desk.out_windows().is_empty());
    assert!(!desk.dock("endue.terminal"), "only a window out docks");
    assert!(
        !desk.pop_out("nothing", OS),
        "only a window of the canvas pops out"
    );
}

#[test]
fn the_plan_draws_no_window_out_but_seats_and_shows_its_plugin() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    let plan = desk.host_plan(W, H, TopChrome::default(), &Unseen);
    let drawn: Vec<&str> = plan.windows.iter().map(|w| w.id.as_str()).collect();
    assert_eq!(drawn, vec!["endue.notes"]);
    assert_eq!(plan.out.len(), 1);
    let out = &plan.out[0];
    assert_eq!(
        (out.id.as_str(), out.desktop.as_str()),
        ("endue.terminal", "1")
    );
    assert_eq!(out.frame, OS);
    assert_eq!(out.plugins, vec!["endue.terminal".to_owned()]);
    assert_eq!(out.title, "endue.terminal");
    assert!(plan.out_of("endue.terminal").is_some());
    // The live budget counts it in sight; its surface keeps a seat the size of its OS window.
    assert!(plan.shown.contains("endue.terminal"));
    let seat = plan.seat("endue.terminal");
    assert_eq!(seat.size, Some((720.0, 450.0)));
    assert!(seat.visible);
}

#[test]
fn a_window_out_stays_out_on_another_desktop_and_docks_back_to_its_own() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    desk.set_desktop("2");
    let plan = desk.host_plan(W, H, TopChrome::default(), &Unseen);
    assert_eq!(
        plan.out.len(),
        1,
        "an OS window is on no desktop of the desk"
    );
    assert!(plan.seat("endue.terminal").visible);
    assert!(desk.dock("endue.terminal"));
    assert_eq!(desk.here(), "1", "its desktop comes to the front");
    assert!(rect_of(&desk, "endue.terminal").is_some());
}

#[test]
fn tile_and_cascade_leave_a_window_out_where_it_is() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    let mut arranger = Arranger::default();
    let done = (arranger.arrange(&mut desk, ArrangeKind::Tile, W, H, 12.0, EPOCH)).expect("tiled");
    let moved: Vec<&str> = done.windows.iter().map(|k| k.id.as_str()).collect();
    assert_eq!(moved, vec!["endue.notes"]);
    let (_, out) = desk.out_window("endue.terminal").unwrap();
    assert_eq!(out.rect(), Rect::new(100.0, 100.0, 500.0, 300.0));
    assert_eq!(out.out, Some(OS));
}

#[test]
fn a_window_out_closes_from_any_desktop() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    desk.set_desktop("3");
    assert_eq!(
        desk.close_window("endue.terminal"),
        vec!["endue.terminal".to_owned()]
    );
    assert!(desk.out_windows().is_empty());
}

#[test]
fn the_window_commands_pop_out_dock_and_follow_the_os_window_and_publish() {
    let mut wm = Wm::new();
    wm.start(desk(), Size { w: W, h: H });
    let published = |outs: &[Out]| outs.iter().any(|o| matches!(o, Out::Publish(_)));
    // Pop out with no frame: as large as the window, the shell to place it.
    let outs = wm.run(&Op::PopOut { frame: None }, Some("endue.terminal"));
    assert!(published(&outs));
    let (_, p) = wm.desk().out_window("endue.terminal").expect("out");
    assert_eq!(p.out, Some(Rect::new(0.0, 0.0, 500.0, 300.0)));
    // The OS window moved: published; the same frame again: nothing.
    let at = Op::OutFrame { frame: OS };
    assert!(published(&wm.run(&at, Some("endue.terminal"))));
    assert!(wm.run(&at, Some("endue.terminal")).is_empty());
    // A window command of the canvas finds no window out; the dock does.
    assert!(wm.run(&Op::Maximize, Some("endue.terminal")).is_empty());
    assert!(published(&wm.run(&Op::Dock, Some("endue.terminal"))));
    assert!(wm.desk().out_windows().is_empty());
    assert!(wm.run(&Op::Dock, Some("endue.terminal")).is_empty());
}

#[test]
fn a_window_out_round_trips_through_the_saved_session() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    let text = serde_json::to_string(&desk).unwrap();
    assert!(text.contains("\"out\""));
    let back: Desk = serde_json::from_str(&text).unwrap();
    assert_eq!(back.out_window("endue.terminal").unwrap().1.out, Some(OS));
}

/// Terminal out of the canvas on desktop 1, Notes on it, the desk on desktop 2 with Terminal in
/// use: what `desk.windows.list` answers is the contract's vector `desk-windows-list-out.json`.
#[test]
fn the_window_list_names_a_window_out_with_its_frame_and_where_it_docks() {
    let mut desk = desk();
    desk.pop_out("endue.terminal", OS);
    desk.set_desktop("2");
    desk.focus_tab("endue.terminal", None);
    assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
    let shot = serde_json::to_value(desk.snapshot(W, H)).unwrap();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../specs/bridge/v0/vectors/valid/desk-windows-list-out.json");
    if std::env::var_os("DESK_WRITE_VECTOR").is_some() {
        let vector = serde_json::json!({
            "target": "BrainDesk",
            "description": "a window out of the canvas (#235): Terminal in an OS window of its own, in use, listed after the windows of the desktop in front (none here) with its OS frame, where it docks back on desktop 1 and no stacking place; Notes on desktop 1's canvas; crates/desk-wm/tests/out.rs builds it",
            "instance": shot,
        });
        std::fs::write(&path, serde_json::to_string_pretty(&vector).unwrap() + "\n").unwrap();
    }
    let vector: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert_eq!(vector["target"], "BrainDesk");
    assert_eq!(shot, vector["instance"]);
    let terminal = &shot["windows"][0];
    assert_eq!(terminal["id"], "endue.terminal");
    assert_eq!(
        terminal["out"],
        serde_json::json!({ "x": 1200, "y": 400, "w": 720, "h": 450 })
    );
    assert_eq!(terminal["desktop"], "1");
    assert_eq!(terminal["focused"], true);
    assert!(terminal.get("z").is_none());
}

#[test]
fn an_os_window_with_the_keys_makes_its_window_the_one_in_use() {
    let mut wm = Wm::new();
    wm.start(desk(), Size { w: W, h: H });
    wm.run(&Op::PopOut { frame: Some(OS) }, Some("endue.terminal"));
    wm.run(&Op::Maximize, Some("endue.notes"));
    let published = |outs: &[Out]| outs.iter().any(|o| matches!(o, Out::Publish(_)));
    assert!(published(&wm.run(&Op::Focus, Some("endue.terminal"))));
    assert_eq!(wm.desk().focused.as_deref(), Some("endue.terminal"));
    // Already in use, or a window of the canvas (the page focuses those): nothing.
    assert!(wm.run(&Op::Focus, Some("endue.terminal")).is_empty());
    assert!(wm.run(&Op::Focus, Some("endue.notes")).is_empty());
    let plan = wm.desk().host_plan(W, H, TopChrome::default(), &Unseen);
    assert!(plan.out[0].focused);
}

/// #239: what shows a plugin (`desk.display.show`, `desk.plugins.open`, a file or a buffer of its
/// own shown) finds its window out of the canvas and puts it in use, where it is.
#[test]
fn showing_a_plugin_whose_window_is_out_puts_that_window_in_use_and_opens_no_other() {
    let mut desk = desk();
    assert!(desk.pop_out("endue.terminal", OS));
    desk.focus_tab("endue.notes", None);
    desk.show_plugin("endue.terminal");
    assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
    assert_eq!(ids(&desk.windows()), vec!["endue.notes".to_owned()]);
    assert_eq!(desk.out_windows().len(), 1);
    assert_eq!(desk.out_window("endue.terminal").unwrap().1.out, Some(OS));
    // From another desktop too: the desk stays where it is, as the OS window is on none.
    desk.switch_to("2");
    desk.show_plugin("endue.terminal");
    assert_eq!(desk.here(), "2");
    assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
    assert!(desk.windows().is_empty());
}

/// Terminal's window holding a second Terminal as a tab (ADR 0270), the second shown.
fn tabbed() -> Desk {
    let mut desk = desk();
    desk.adopt("endue.terminal@2", "Terminal", desk_wm::FREE);
    (desk.add_tab("endue.terminal", "plugin:endue.terminal@2")).expect("a tab");
    desk
}

fn views(p: &desk_wm::Placement) -> Vec<String> {
    p.tabs().into_iter().map(|t| t.view).collect()
}

/// The window on the canvas that is neither Notes nor `but`.
fn other(desk: &Desk, but: &str) -> Vec<desk_wm::Placement> {
    (desk.windows().into_iter())
        .filter(|p| p.id != "endue.notes" && p.id != but)
        .collect()
}

/// A window of tabs pops out with the tab it shows; its other tabs stay where it was, in a window
/// of their own, so the OS window shows one plugin's page and no tab is left without a window.
#[test]
fn a_window_of_tabs_pops_out_with_the_tab_it_shows_and_leaves_the_others_in_its_place() {
    let mut desk = tabbed();
    assert!(desk.pop_out("endue.terminal", OS));
    let (_, out) = desk.out_window("endue.terminal").expect("out");
    assert_eq!(views(&out), ["plugin:endue.terminal@2"]);
    assert_eq!(desk.plugins_of(&out), ["endue.terminal@2"]);
    let left = other(&desk, "endue.terminal");
    assert_eq!(left.len(), 1, "the other tabs stay on the canvas");
    assert_eq!(views(&left[0]), ["plugin:endue.terminal"]);
    assert_eq!(left[0].rect(), Rect::new(100.0, 100.0, 500.0, 300.0));
    assert_eq!(desk.plugins_of(&left[0]), ["endue.terminal"]);
    // The window out is still the one in use, and docks back alone.
    assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
    assert!(desk.dock("endue.terminal"));
    let back = desk.window("endue.terminal").expect("docked");
    assert_eq!(views(&back), ["plugin:endue.terminal@2"]);
}

/// The window's own tab shown, it goes out as that one; the plan hands the OS window one page.
#[test]
fn the_windows_own_tab_shown_goes_out_alone_and_the_plan_lists_one_plugin() {
    let mut desk = tabbed();
    desk.focus_tab("endue.terminal", Some("p1"));
    assert!(desk.pop_out("endue.terminal", OS));
    let plan = desk.host_plan(W, H, TopChrome::default(), &Unseen);
    assert_eq!(plan.out.len(), 1);
    assert_eq!(plan.out[0].plugins, ["endue.terminal"]);
    assert_eq!(
        plan.windows.len(),
        2,
        "Notes and the window of the other tab"
    );
    let left = other(&desk, "endue.terminal");
    assert_eq!(views(&left[0]), ["plugin:endue.terminal@2"]);
}
