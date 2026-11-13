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
