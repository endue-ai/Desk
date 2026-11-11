use super::{Hosted, Outcome};
use crate::compositor_window::report::DeskReport;
use desk_wm::{Desk, Size, Step};
use serde_json::{Value, json};
use std::time::Instant;

const NOTES: &str = "main.endue-notes";
const MAIL: &str = "main.endue-mail";

fn frame(plugin: &str, host: &str, state: &str, loads: u64) -> Value {
    json!({ "plugin": plugin, "host": host, "src": format!("desk-plugin://{host}/index.html"),
        "loads": loads, "state": state })
}

/// The desk of the two plugin windows, Mail filling the app when `filled`.
fn desk(filled: bool) -> Desk {
    let mail = json!({ "id": "endue.mail", "plugin": "endue.mail", "x": 0, "y": 0, "w": 400,
        "h": 300, "pinned": false, "floating": true, "fill": "full",
        "restore": { "x": 0, "y": 0, "w": 400, "h": 300 } });
    let session = if filled {
        json!({ "1": { "surfaces": [mail] } })
    } else {
        json!({})
    };
    serde_json::from_value(json!({ "desktop": "1", "session": session,
        "adopted": [{ "id": "endue.notes", "title": "Notes", "slot": 0 },
            { "id": "endue.mail", "title": "Mail", "slot": 1 }] }))
    .unwrap()
}

/// The page's report of the frames, `live` kept out of sight.
fn reported(seq: u64, frames: Vec<Value>, live: usize) -> DeskReport {
    serde_json::from_value(json!({
        "seq": seq, "width": 1440, "height": 900,
        "frames": frames,
        "budget": { "live": live }
    }))
    .unwrap()
}

/// The window manager holds `desk(filled)` (the runtime's edits made it so), then the page reports.
fn report(
    hosted: &mut Hosted,
    now: Instant,
    seq: u64,
    filled: bool,
    frames: Vec<Value>,
    live: usize,
) -> Outcome {
    let screen = Size {
        w: 1440.0,
        h: 900.0,
    };
    hosted.wm.start(desk(filled), screen);
    hosted.apply(reported(seq, frames, live), now)
}

fn kinds(outcome: &Outcome) -> Vec<String> {
    (outcome.steps.iter())
        .map(|s| {
            let kind = match s {
                Step::Load { .. } => "load",
                Step::Create { .. } => "create",
                Step::Resize { .. } => "resize",
                Step::Show { .. } => "show",
                Step::Hide { .. } => "hide",
                Step::Sleep { .. } => "sleep",
                Step::Wake { .. } => "wake",
                Step::Destroy { .. } => "destroy",
            };
            format!("{kind} {}", s.surface())
        })
        .collect()
}

#[test]
fn the_first_report_makes_each_surface_at_its_panes_size_and_keeps_both() {
    let mut hosted = Hosted::new(2.0);
    let now = Instant::now();
    let both = vec![
        frame("endue.notes", NOTES, "live", 1),
        frame("endue.mail", MAIL, "live", 1),
    ];
    let out = report(&mut hosted, now, 1, false, both.clone(), 8);
    assert_eq!(
        kinds(&out),
        [
            format!("load {NOTES}"),
            format!("create {NOTES}"),
            format!("load {MAIL}"),
            format!("create {MAIL}")
        ]
    );
    let Step::Create { size, scale, .. } = &out.steps[1] else {
        panic!("{:?}", out.steps[1]);
    };
    let pane = hosted.plan().unwrap().seat("endue.notes").size.unwrap();
    assert_eq!(*size, (pane.0 as u32, pane.1 as u32));
    assert_eq!(*scale, 2.0);
    assert_eq!(
        out.live,
        Some(vec!["endue.mail".into(), "endue.notes".into()])
    );
    // An older report arriving late changes nothing; the same one again sends no set.
    let late = report(&mut hosted, now, 0, true, both.clone(), 8);
    assert_eq!(late, Outcome::default());
    assert_eq!(
        report(&mut hosted, now, 2, false, both, 8),
        Outcome::default()
    );
}

#[test]
fn a_window_out_of_sight_past_the_budget_sleeps_once_the_runtime_took_it_away_and_wakes_back() {
    let mut hosted = Hosted::new(1.0);
    let now = Instant::now();
    let live = |n| {
        vec![
            frame("endue.notes", NOTES, "live", n),
            frame("endue.mail", MAIL, "live", 1),
        ]
    };
    report(&mut hosted, now, 1, false, live(1), 0);
    // Mail fills the app: Notes is out of sight, and none may stay live out of sight.
    let out = report(&mut hosted, now, 2, true, live(1), 0);
    assert_eq!(out.live, Some(vec!["endue.mail".into()]));
    assert!(kinds(&out).contains(&format!("hide {NOTES}")));
    let asleep = vec![
        frame("endue.notes", NOTES, "asleep", 1),
        frame("endue.mail", MAIL, "live", 1),
    ];
    let out = report(&mut hosted, now, 3, true, asleep, 0);
    assert_eq!(kinds(&out), [format!("sleep {NOTES}")]);
    // Mail back to its slot: Notes is in sight again, kept, and wakes once its frame is back on
    // its second page.
    let out = report(&mut hosted, now, 4, false, live(2), 0);
    assert_eq!(
        out.live,
        Some(vec!["endue.mail".into(), "endue.notes".into()])
    );
    assert_eq!(kinds(&out)[0], format!("wake {NOTES}"));
    // Its frame moved in the page (a split, the drawer): the runtime counts no page, nothing loads.
    let out = report(&mut hosted, now, 5, false, live(2), 0);
    assert_eq!(out, Outcome::default());
    // Taken away and back between two reports: the third page loads in place of the second (W1).
    let out = report(&mut hosted, now, 6, false, live(3), 0);
    assert_eq!(kinds(&out), [format!("load {NOTES}")]);
}

#[test]
fn a_window_whose_frame_the_page_never_showed_is_kept_in_sight_so_its_frame_comes() {
    let mut hosted = Hosted::new(1.0);
    let now = Instant::now();
    // At start the page may report the windows before any frame: none is made, both are kept.
    let out = report(&mut hosted, now, 1, false, vec![], 0);
    assert!(out.steps.is_empty());
    assert_eq!(
        out.live,
        Some(vec!["endue.mail".into(), "endue.notes".into()])
    );
    // A stopped one is not counted (the person reloads it), and has no surface.
    let stopped = vec![frame("endue.notes", NOTES, "stopped", 1)];
    let out = report(&mut hosted, now, 2, false, stopped, 0);
    assert_eq!(out.live, Some(vec!["endue.mail".into()]));
    assert!(out.steps.is_empty());
}
