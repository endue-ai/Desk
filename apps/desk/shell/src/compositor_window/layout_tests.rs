use super::{Box, Layout, Placed, Report, Size, Step, owner};
use serde_json::Value;

const NOTES: &str = "main.endue-notes";
const SRC: &str = "desk-plugin://main.endue-notes/endue.notes/ui/index.html?v=1";

fn placed(loads: u64, width: f64, visible: bool, asleep: bool) -> Placed {
    let rect = Box {
        x: 10.0,
        y: 20.0,
        width,
        height: 300.0,
    };
    Placed {
        host: NOTES.into(),
        src: SRC.into(),
        loads,
        size: Size {
            width,
            height: 300.0,
        },
        rect,
        pieces: if visible { vec![rect] } else { vec![] },
        asleep,
    }
}

fn report(seq: u64, surfaces: Vec<Placed>) -> Report {
    Report {
        seq,
        scale: 2.0,
        surfaces,
    }
}

/// The steps as `type` names (and `load` for a load).
fn kinds(steps: &[Step]) -> Vec<String> {
    steps
        .iter()
        .map(|s| match s {
            Step::Load { .. } => "load".to_owned(),
            Step::Send(m) => serde_json::to_value(m).unwrap()["type"]
                .as_str()
                .unwrap()
                .to_owned(),
        })
        .collect()
}

fn sent(steps: &[Step], index: usize) -> Value {
    match &steps[index] {
        Step::Send(m) => serde_json::to_value(m).unwrap(),
        Step::Load { url, .. } => Value::String(url.clone()),
    }
}

#[test]
fn a_new_frame_is_loaded_and_created_and_a_gone_one_destroyed() {
    let mut layout = Layout::default();
    let steps = layout.apply(report(1, vec![placed(1, 400.0, true, false)]));
    assert_eq!(kinds(&steps), ["load", "create"]);
    assert_eq!(sent(&steps, 0), SRC);
    let create = sent(&steps, 1);
    assert_eq!(create["plugin"], "endue.notes");
    assert_eq!(create["view"], "main");
    assert_eq!(
        create["size"],
        serde_json::json!({ "width": 400, "height": 300 })
    );
    assert_eq!(
        (create["scale"].as_f64(), &create["hidden"]),
        (Some(2.0), &Value::Bool(false))
    );
    assert!(
        layout
            .apply(report(2, vec![placed(1, 400.0, true, false)]))
            .is_empty(),
        "nothing changed"
    );
    assert_eq!(kinds(&layout.apply(report(3, vec![]))), ["destroy"]);
}

#[test]
fn size_visibility_and_a_new_document_follow_the_frame() {
    let mut layout = Layout::default();
    layout.apply(report(1, vec![placed(1, 400.0, true, false)]));
    assert_eq!(
        kinds(&layout.apply(report(2, vec![placed(1, 500.0, true, false)]))),
        ["resize"]
    );
    assert_eq!(
        kinds(&layout.apply(report(3, vec![placed(1, 500.0, false, false)]))),
        ["hide"]
    );
    assert_eq!(
        kinds(&layout.apply(report(4, vec![placed(1, 500.0, true, false)]))),
        ["show"]
    );
    assert_eq!(
        kinds(&layout.apply(report(5, vec![placed(2, 500.0, true, false)]))),
        ["load"],
        "a reload"
    );
    assert!(
        layout.apply(report(4, vec![])).is_empty(),
        "a late report is ignored"
    );
    assert_eq!(kinds(&layout.occluded(true)), ["hide"]);
    assert_eq!(kinds(&layout.occluded(false)), ["show"]);
    assert_eq!(kinds(&layout.pace(30)), ["pace"]);
}

#[test]
fn an_unloaded_frame_sleeps_and_wakes_and_a_dead_one_wakes_on_its_reload() {
    let mut layout = Layout::default();
    assert!(
        layout
            .apply(report(1, vec![placed(1, 400.0, true, true)]))
            .is_empty(),
        "made once it wakes"
    );
    assert_eq!(
        kinds(&layout.apply(report(2, vec![placed(2, 400.0, true, false)]))),
        ["load", "create"]
    );
    assert_eq!(
        kinds(&layout.apply(report(3, vec![placed(2, 400.0, true, true)]))),
        ["sleep"]
    );
    assert_eq!(layout.surfaces(), vec![(NOTES.to_owned(), true)]);
    assert_eq!(
        kinds(&layout.apply(report(4, vec![placed(3, 400.0, true, false)]))),
        ["wake"]
    );
    layout.died(NOTES);
    assert!(
        layout
            .apply(report(5, vec![placed(3, 400.0, true, false)]))
            .is_empty(),
        "dead until reloaded"
    );
    assert_eq!(
        kinds(&layout.apply(report(6, vec![placed(4, 400.0, true, false)]))),
        ["wake"]
    );
}

#[test]
fn a_surface_host_names_its_plugin_and_view() {
    assert_eq!(
        owner(NOTES),
        Some(("endue.notes".to_owned(), "main".to_owned()))
    );
    assert_eq!(owner("localhost"), None);
}
