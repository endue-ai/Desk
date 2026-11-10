//! Isolation gates (#58, #32 §9 and §11) on the CEF desk in compositor mode, through the surface
//! probe's desk (`src/probe/desk_loop.rs`, `gates.rs`): a renderer whose main thread spins forever
//! leaves the desk's frame time and the other surfaces' paints as they were; a killed renderer is
//! the one surface that dies while the desk keeps composing and the others keep painting; a surface
//! at its memory cap goes to sleep, its renderer and memory go, its last frame stays, and the desk
//! stays up. Each stretch is judged against the same run's own stretch before it, so a loaded
//! machine moves both. The process checks need Unix (`ps`, `kill`); Windows waits for #61.

mod support;

use std::sync::OnceLock;

use serde_json::Value;
use support::probe;

fn isolation() -> Option<&'static Value> {
    static REPORT: OnceLock<Option<Value>> = OnceLock::new();
    REPORT
        .get_or_init(|| probe("isolation", "isolation", &[]))
        .as_ref()
}

fn ms(stretch: &Value, key: &str) -> f64 {
    stretch["frames"][key].as_f64().unwrap_or(f64::MAX)
}

fn rate(stretch: &Value, surface: &str) -> f64 {
    stretch["paints_per_s"][surface].as_f64().unwrap_or(0.0)
}

fn fps(stretch: &Value) -> f64 {
    let frames = stretch["frames"]["frames"].as_u64().unwrap_or(0) as f64;
    frames / stretch["seconds"].as_f64().unwrap_or(f64::MAX)
}

/// The longest gap between two of the desk's frames anywhere in a stretch: six frames at 60 Hz.
const STALL_MS: f64 = 100.0;

/// The desk's frames in `during` held up against `before`: as many a second, as evenly spaced, as
/// quickly composed (a frame interval past 1.5 times the earlier p95 plus a few ms is a stall),
/// and never one gap of `STALL_MS`.
fn frames_hold(before: &Value, during: &Value) -> Result<(), String> {
    let interval = ms(during, "interval_p95_ms");
    let limit = ms(before, "interval_p95_ms") * 1.5 + 4.0;
    if interval > limit {
        return Err(format!("frame interval p95 {interval} ms past {limit} ms"));
    }
    let longest = ms(during, "interval_max_ms");
    if longest > STALL_MS {
        return Err(format!("a {longest} ms gap between two frames"));
    }
    let compose = ms(during, "compose_p95_ms");
    if compose > ms(before, "compose_p95_ms") * 2.0 + 2.0 {
        return Err(format!("compose p95 {compose} ms"));
    }
    let (was, is) = (fps(before), fps(during));
    if is < was * 0.8 {
        return Err(format!("{is:.1} frames a second, {was:.1} before"));
    }
    Ok(())
}

/// The other surfaces kept painting: at least half their earlier rate, and 20 a second.
fn others_paint(before: &Value, during: &Value) -> Result<(), String> {
    for surface in ["a", "b"] {
        let (was, is) = (rate(before, surface), rate(during, surface));
        if is < (was * 0.5).max(20.0) {
            return Err(format!("{surface} painted {is}/s, {was}/s before"));
        }
    }
    Ok(())
}

#[test]
fn a_busy_renderer_leaves_the_desks_frame_time_and_the_others_painting() {
    let Some(report) = isolation() else { return };
    eprintln!("isolation: {report}");
    assert_eq!(report["started"], true, "{report}");
    let busy = &report["busy"];
    assert_eq!(busy["spun"], true, "{busy}");
    if cfg!(unix) {
        let cores = busy["cores"].as_f64().unwrap_or(0.0);
        assert!(cores > 0.7, "its renderer spins a core: {cores}");
    }
    let (before, during) = (&report["before"], &busy["desk"]);
    assert!(
        rate(during, "busy") < 2.0,
        "the spinning page paints nothing: {during}"
    );
    frames_hold(before, during).unwrap_or_else(|why| panic!("{why}: {report}"));
    others_paint(before, during).unwrap_or_else(|why| panic!("{why}: {report}"));
}

#[test]
fn a_killed_renderer_dies_alone_while_the_desk_keeps_composing() {
    let Some(report) = isolation() else { return };
    if !cfg!(unix) {
        eprintln!(
            "a_killed_renderer_dies_alone_while_the_desk_keeps_composing: skipped, needs kill (#61)"
        );
        return;
    }
    let death = &report["death"];
    assert_eq!(death["killed"], true, "{death}");
    let deaths = death["deaths"].as_array().cloned().unwrap_or_default();
    assert_eq!(deaths.len(), 1, "only the killed one: {death}");
    assert_eq!(
        (&deaths[0]["surface"], &deaths[0]["reason"]),
        (&Value::from("victim"), &Value::from("killed"))
    );
    let (before, during) = (&report["before"], &death["desk"]);
    frames_hold(before, during).unwrap_or_else(|why| panic!("{why}: {report}"));
    others_paint(before, during).unwrap_or_else(|why| panic!("{why}: {report}"));
}

#[test]
#[ignore = "input reaches surfaces with the compositor's input path (#56): once it does, a killed \
            renderer's neighbours must take pointer and key input as before"]
fn a_killed_renderer_leaves_the_others_taking_input() {
    let report = probe("isolation_input", "isolation-input", &[]);
    panic!("the probe has no input scenario until #56: {report:?}");
}

#[test]
fn a_surface_at_its_memory_cap_sleeps_and_the_desk_stays_up() {
    let Some(report) = probe("isolation", "cap", &[]) else {
        return;
    };
    eprintln!("cap: {report}");
    assert_eq!(report["started"], true, "{report}");
    if !cfg!(unix) {
        eprintln!(
            "a_surface_at_its_memory_cap_sleeps_and_the_desk_stays_up: skipped, needs ps (#61)"
        );
        return;
    }
    let cap = report["cap_mb"].as_f64().unwrap_or(0.0);
    assert!(
        report["reached_ms"].as_u64().is_some(),
        "the page's renderer reached the cap of {cap} MiB: {report}"
    );
    let asleep = &report["asleep"];
    assert_eq!(asleep["browser"], false, "asleep, no browser: {asleep}");
    assert_eq!(asleep["state"], "Asleep { hidden: false }", "{asleep}");
    assert_eq!(
        asleep["renderer_gone"], true,
        "its renderer and memory went: {asleep}"
    );
    assert!(
        asleep["last_frame"]
            .as_array()
            .is_some_and(|p| p.len() == 4),
        "its last frame stays with the compositor: {asleep}"
    );
    assert_eq!(
        report["deaths"],
        Value::Array(vec![]),
        "a sleep is not a death, and no other surface died: {report}"
    );
    let desk = &report["desk"];
    for surface in ["a", "b"] {
        assert!(
            rate(desk, surface) >= 20.0,
            "{surface} kept painting: {desk}"
        );
    }
    assert!(
        fps(desk) >= 40.0,
        "the desk kept composing near 60 Hz: {desk}"
    );
}
