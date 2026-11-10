//! Acceptance (#52): an off-screen surface's lifecycle. A hidden surface paints nothing while another
//! keeps painting; a sleeping one has no browser and its renderer process is gone, and a wake brings
//! a new one; a killed renderer is reported as that surface's `died` (the direct signal #44's
//! recovery takes), only that one, while the others keep painting, and a wake loads it again; twenty
//! surfaces made hidden and shown together all paint again. Every surface renders on the desk's
//! frame clock (#111): hidden or asleep it gets no begin frame, and with the clock held an animating
//! page paints nothing. Runs the shell's surface probe (`src/probe.rs`); the process checks need
//! Unix (`ps`, `kill`).

mod support;

use std::sync::OnceLock;

use serde_json::Value;
use support::probe;

fn report() -> Option<&'static Value> {
    static REPORT: OnceLock<Option<Value>> = OnceLock::new();
    REPORT
        .get_or_init(|| {
            let report = probe("lifecycle", "lifecycle", &[]);
            if let Some(report) = &report {
                eprintln!("lifecycle: {report}");
            }
            report
        })
        .as_ref()
}

#[test]
fn twenty_surfaces_made_hidden_paint_nothing_and_all_paint_once_shown() {
    let Some(report) = probe("lifecycle", "many", &[]) else {
        return;
    };
    let hidden = report["hidden"].as_array().cloned().unwrap_or_default();
    let shown = report["shown"].as_array().cloned().unwrap_or_default();
    assert_eq!(hidden.len(), 20, "{report}");
    assert!(
        hidden.iter().all(|p| p == 0),
        "made hidden, no paint: {report}"
    );
    assert!(
        shown.iter().all(|p| p.as_u64() >= Some(20)),
        "every one paints once shown: {report}"
    );
}

#[test]
fn a_hidden_surface_paints_nothing_while_another_keeps_painting() {
    let Some(report) = report() else { return };
    assert_eq!(report["started"], true, "{report}");
    let hidden = &report["hidden"];
    assert_eq!(hidden["hidden_paints"], 0, "{hidden}");
    assert_eq!(
        hidden["begin_frames"], 0,
        "no begin frame while hidden: {hidden}"
    );
    assert!(hidden["other_paints"].as_u64() >= Some(20), "{hidden}");
    assert!(
        report["shown_paints"].as_u64() >= Some(5),
        "shown again, it paints: {report}"
    );
}

#[test]
fn the_compositors_pace_caps_a_surfaces_frame_rate() {
    let Some(report) = report() else { return };
    let paced = report["paced_fps"].as_f64().unwrap_or(f64::MAX);
    assert!(
        paced > 3.0 && paced <= 14.0,
        "paced at 10 fps, it painted {paced} a second"
    );
}

#[test]
fn a_surface_renders_only_on_the_desks_frame_clock() {
    let Some(report) = report() else { return };
    let clock = &report["clock"];
    assert_eq!(
        clock["held_paints"], 0,
        "the clock held, an animating page paints nothing: {clock}"
    );
    assert!(
        clock["paints_after"].as_u64() >= Some(10),
        "let go, it paints again: {clock}"
    );
}

#[test]
fn a_sleeping_surface_has_no_browser_and_no_renderer() {
    let Some(report) = report() else { return };
    let asleep = &report["asleep"];
    assert_eq!(asleep["browser"], false, "{asleep}");
    assert_eq!(asleep["closed"], true, "{asleep}");
    assert_eq!(asleep["begin_frames"], 0, "no begin frame asleep: {asleep}");
    if cfg!(unix) {
        assert_eq!(asleep["renderer_alive"], false, "{asleep}");
        let before = report["renderers_before"].as_u64().unwrap_or(0);
        assert!(asleep["renderers"].as_u64() < Some(before), "{report}");
    }
    assert_eq!(
        report["woke"], true,
        "a wake opens it again in a new renderer: {report}"
    );
}

#[test]
fn a_killed_renderer_dies_alone_and_a_wake_loads_it_again() {
    let Some(report) = report() else { return };
    if !cfg!(unix) {
        eprintln!(
            "a_killed_renderer_dies_alone_and_a_wake_loads_it_again: skipped, needs kill (#61)"
        );
        return;
    }
    let death = &report["death"];
    assert_eq!(
        (&death["killed"], &death["noticed"]),
        (&Value::Bool(true), &Value::Bool(true)),
        "{death}"
    );
    let deaths = death["deaths"].as_array().cloned().unwrap_or_default();
    assert_eq!(deaths.len(), 1, "only the killed one: {death}");
    assert_eq!(
        (&deaths[0]["surface"], &deaths[0]["reason"]),
        (&Value::from("c"), &Value::from("killed"))
    );
    assert!(death["others_painted"]["a"].as_u64() >= Some(10), "{death}");
    assert!(death["others_painted"]["b"].as_u64() >= Some(10), "{death}");
    assert_eq!(death["state"], "Dead { hidden: false }", "{death}");
    assert_eq!(death["reloaded"], true, "{death}");
}
