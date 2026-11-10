//! The spread running on the caller's clock (#54; the controller cases of
//! `packages/runtime/src/arrange/spread.test.ts` at 789c349b): it opens from where the windows are
//! and fans them out over `--motion-slow`, a key or the filter moves the cards over
//! `--motion-fast`, the pointer selects and pans at once, and it closes back to where the windows
//! are over `--motion-base`, on the window chosen or on none. A time the clock is frozen at gives
//! the same frame every run (ADR 0013). `Desk::reveal`, the `reveal` edit, brings the window chosen
//! into sight first.

use desk_wm::edits::{Edit, Kept, apply};
use desk_wm::{
    Desk, Durations, Ending, IDENTITY, KeyPress, Offset, Placement, Rect, Size, Spread,
    SpreadAction, SpreadWindow, screen_rect,
};
use serde_json::json;

const VIEW: (f64, f64) = (1440.0, 900.0);

fn window(id: &str, title: &str, x: f64, y: f64) -> SpreadWindow {
    SpreadWindow {
        id: id.into(),
        title: title.into(),
        rect: Rect::new(x, y, 640.0, 420.0),
        asleep: false,
    }
}

/// Five windows in two rows: Calendar Notes Mail on top, Terminal Files under them.
fn windows() -> Vec<SpreadWindow> {
    vec![
        window("a", "Calendar", 100.0, 100.0),
        window("b", "Notes", 600.0, 100.0),
        window("c", "Mail", 1100.0, 100.0),
        window("d", "Terminal", 100.0, 500.0),
        window("e", "Files", 600.0, 500.0),
    ]
}

/// The spread opened at 1000 ms with Notes in use.
fn open(durations: Durations, flat: bool) -> Spread {
    Spread::open(windows(), VIEW, flat, Some("b"), durations, 1000.0).expect("five windows")
}

fn press(spread: &mut Spread, key: &str, now: f64) -> SpreadAction {
    spread.key(&KeyPress::new(key), now)
}

#[test]
fn it_opens_from_where_the_windows_are_and_fans_them_out_over_its_opening_motion() {
    let spread = open(Durations::default(), false);
    let first = spread.frame(1000.0);
    assert!(first.poses.values().all(|p| *p == IDENTITY), "{first:?}");
    assert!(first.moving);
    // Part of the way there: the same frame for the same time, every run.
    let mid = spread.frame(1200.0);
    assert_eq!(mid, spread.frame(1200.0));
    let fanned = spread.frame(1400.0);
    assert!(!fanned.moving && fanned.closed.is_none());
    assert_eq!(fanned.poses, spread.model().poses());
    let b_mid = mid.poses["b"];
    let b_end = fanned.poses["b"];
    assert!(b_mid.scale < 1.0 && b_mid.scale > b_end.scale, "{b_mid:?}");
    assert!(fanned.poses.values().any(|p| p.rotate_y != 0.0));
    assert!(fanned.poses.values().any(|p| p.z < -100.0));
    assert!(fanned.poses.values().all(|p| p.scale < 1.0));
}

#[test]
fn reduced_motion_lays_the_windows_out_flat_at_once() {
    let durations = Durations::from_tokens(|_| Some("400ms".into()), true);
    assert_eq!(durations, Durations::none());
    let spread = open(durations, true);
    let frame = spread.frame(1000.0);
    assert!(!frame.moving);
    for p in frame.poses.values() {
        assert_eq!([p.rotate_y, p.rotate_x, p.z], [0.0, 0.0, 0.0]);
        assert!(p.scale < 1.0);
    }
}

#[test]
fn the_motions_take_the_themes_durations() {
    let tokens = |name: &str| match name {
        "motionSlow" => Some("0.5s".to_owned()),
        "motionFast" => Some("100ms".to_owned()),
        "motionBase" => Some("nonsense".to_owned()),
        _ => None,
    };
    let durations = Durations::from_tokens(tokens, false);
    assert_eq!(
        (durations.open, durations.moved, durations.close),
        (500.0, 100.0, 220.0)
    );
    let spread = open(durations, false);
    assert!(spread.frame(1499.0).moving && !spread.frame(1500.0).moving);
}

#[test]
fn a_key_moves_the_cards_over_the_fast_motion_and_enter_answers_the_window() {
    let mut spread = open(Durations::default(), false);
    assert_eq!(
        press(&mut spread, "ArrowRight", 1400.0),
        SpreadAction::Moved
    );
    assert_eq!(spread.model().selected(), Some("c"));
    let lifting = spread.frame(1475.0);
    assert!(lifting.moving);
    assert!(!spread.frame(1550.0).moving);
    assert_eq!(spread.frame(1550.0).poses, spread.model().poses());
    // Enter names the window and closes nothing: the caller brings it into sight first.
    let chosen = press(&mut spread, "Enter", 1600.0);
    assert_eq!(chosen, SpreadAction::Choose { id: "c".into() });
    assert!(spread.closing().is_none());
}

#[test]
fn choosing_closes_back_to_where_the_windows_are_then_on_that_window() {
    let mut spread = open(Durations::default(), false);
    // Brought into sight, Mail moved: the windows go back to where they are now.
    let mut after = windows();
    after[2].rect = Rect::new(780.0, 100.0, 640.0, 420.0);
    spread.choose("c", after.clone(), 1400.0);
    assert_eq!(spread.closing(), Some(&Ending::Chosen("c".into())));
    assert_eq!(spread.model().windows(), after.as_slice());
    assert_eq!(spread.frame(1500.0).closed, None, "still closing");
    let closed = spread.frame(1620.0);
    assert_eq!(closed.closed, Some(Ending::Chosen("c".into())));
    assert!(closed.poses.values().all(|p| *p == IDENTITY));
    // Once it closes no key acts.
    assert_eq!(press(&mut spread, "ArrowLeft", 1700.0), SpreadAction::None);
}

#[test]
fn escape_closes_on_nothing() {
    let mut spread = open(Durations::default(), false);
    press(&mut spread, "ArrowDown", 1400.0);
    assert_eq!(press(&mut spread, "Escape", 1450.0), SpreadAction::Cancel);
    assert_eq!(spread.frame(1670.0).closed, Some(Ending::Cancelled));
}

#[test]
fn typing_filters_by_title_and_the_filtered_out_fade() {
    let mut spread = open(Durations::default(), false);
    spread.filter("i", 1400.0);
    let shown: Vec<&str> = spread
        .model()
        .shown()
        .iter()
        .map(|w| w.id.as_str())
        .collect();
    assert_eq!(shown, ["d", "e", "c"]);
    assert_eq!(spread.model().selected(), Some("d"));
    let after = spread.frame(1550.0);
    assert_eq!(
        (after.poses["b"].opacity, after.poses["d"].opacity),
        (0.0, 1.0)
    );
    spread.filter("zzz", 1600.0);
    assert_eq!(press(&mut spread, "Enter", 1600.0), SpreadAction::None);
}

#[test]
fn the_pointer_selects_and_the_scrim_pans_and_zooms_at_once() {
    let mut spread = open(Durations::default(), false);
    assert!(spread.hover("e", 1400.0));
    assert!(!spread.hover("e", 1410.0), "already selected");
    assert!(!spread.frame(1560.0).moving);
    let before = spread.frame(1560.0).poses["a"];
    spread.pan(40.0, -10.0, 1600.0);
    let panned = spread.frame(1600.0);
    assert!(!panned.moving);
    let a = panned.poses["a"];
    // Poses are kept to two decimals.
    assert!((a.tx - (before.tx + 40.0)).abs() < 0.011, "{a:?}");
    assert!((a.ty - (before.ty - 10.0)).abs() < 0.011, "{a:?}");
    spread.zoom(2.0, 720.0, 450.0, 1600.0);
    assert!(spread.frame(1600.0).poses["a"].scale > panned.poses["a"].scale);
}

#[test]
fn the_desk_changing_under_it_is_followed_and_no_window_left_closes_it() {
    let mut spread = open(Durations::default(), false);
    let mut more = windows();
    more.push(window("f", "Clock", 1000.0, 600.0));
    assert!(spread.sync(more, 1400.0));
    assert_eq!(spread.model().windows().len(), 6);
    assert!(spread.frame(1400.0).poses.contains_key("f"));
    assert!(!spread.sync(Vec::new(), 1500.0));
    assert_eq!(spread.closing(), Some(&Ending::Cancelled));
    assert!(Spread::open(Vec::new(), VIEW, false, None, Durations::default(), 0.0).is_none());
}

#[test]
fn reveal_pans_a_normal_window_wholly_into_sight_and_leaves_a_floating_one() {
    let mut desk = Desk::default();
    let mut kept = Kept::default();
    let screen = Size {
        w: VIEW.0,
        h: VIEW.1,
    };
    let off = Placement::new("far", "endue.shell", Rect::new(1200.0, 700.0, 400.0, 300.0));
    let mut floating = Placement::new(
        "pinned",
        "endue.shell",
        Rect::new(-50.0, 10.0, 200.0, 100.0),
    );
    floating.floating = Some(true);
    let seeded = json!({ "op": "place", "placement": off });
    let seeded: Edit = serde_json::from_value(seeded).unwrap();
    apply(&mut desk, &mut kept, &seeded, screen);
    let pinned: Edit =
        serde_json::from_value(json!({ "op": "place", "placement": floating })).unwrap();
    apply(&mut desk, &mut kept, &pinned, screen);
    let reveal: Edit = serde_json::from_value(json!({ "op": "reveal", "id": "far" })).unwrap();
    assert_eq!(apply(&mut desk, &mut kept, &reveal, screen), json!(true));
    let pan = desk.pan_of(&desk.here());
    assert_eq!(pan, Offset::new(-160.0, -100.0));
    let p = desk.window("far").unwrap();
    let r = screen_rect(&p, pan, VIEW.0, VIEW.1);
    assert_eq!((r.right(), r.bottom()), (VIEW.0, VIEW.1));
    // Wholly in sight now, and a floating window always is: nothing pans.
    assert_eq!(apply(&mut desk, &mut kept, &reveal, screen), json!(false));
    let other = json!({ "op": "reveal", "id": "pinned" });
    let other: Edit = serde_json::from_value(other).unwrap();
    assert_eq!(apply(&mut desk, &mut kept, &other, screen), json!(false));
}

#[test]
fn the_window_manager_publishes_the_spreads_reveal_and_the_maps_pan_and_ignores_the_spread_op() {
    use desk_wm::interact::{Op, Out, Wm};
    let mut wm = Wm::new();
    let off = Placement::new("far", "endue.shell", Rect::new(1200.0, 700.0, 400.0, 300.0));
    let place: Edit = serde_json::from_value(json!({ "op": "place", "placement": off })).unwrap();
    wm.edit(1, &[place]);
    let rev = wm.rev();
    assert!(matches!(wm.reveal("far").first(), Some(Out::Publish(_))));
    assert_eq!(wm.rev(), rev + 1);
    assert!(wm.reveal("far").is_empty(), "already wholly in sight");
    let pan = Offset::new(-40.0, 12.0);
    assert!(matches!(wm.pan_to(pan).first(), Some(Out::Publish(_))));
    assert_eq!(wm.desk().pan_of(&wm.desk().here()), pan);
    assert!(wm.pan_to(pan).is_empty(), "the same pan publishes nothing");
    // The spread is the compositor's to draw: the window manager alone changes nothing for it.
    assert!(wm.run(&Op::Spread, None).is_empty());
    assert_eq!(
        serde_json::to_value(Op::Spread).unwrap(),
        json!({ "op": "spread" })
    );
}
