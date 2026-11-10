//! The probe's two runs. `import`: a still page of a known colour and a WebGPU page reach the
//! compositor's texture. `lifecycle`: a hidden surface paints nothing while another keeps painting; a
//! sleeping one has no browser and its renderer is gone; a killed renderer is the one `died`, the
//! others keep painting, and a wake loads it again; hidden and asleep, no begin frame reaches it, and
//! with the desk's frame clock held an animating page paints nothing (#111). Each returns numbers;
//! the tests judge them.

use std::time::Duration;

use serde_json::{Value, json};

use super::{Probe, alive, kill, renderers};

const SIZE: (u32, u32) = (320, 200);
const START: Duration = Duration::from_secs(20);

fn surface(probe: &Probe, surface: &str) -> Value {
    let Some((counts, state, plugin)) = probe.host.counts(surface) else {
        return Value::Null;
    };
    json!({
        "plugin": plugin,
        "state": format!("{state:?}"),
        "counts": counts,
        "middle": probe.middle(surface),
        "title": probe.title(surface),
        "browser": probe.host.browser(surface).is_some(),
    })
}

pub fn import(probe: &mut Probe) -> Value {
    probe.create("colour", "probe.colour", SIZE);
    probe.create("webgpu", "probe.webgpu", SIZE);
    probe.create("dot", "probe.dot", SIZE);
    let started = probe.pump_until(START, |p| {
        p.paints("colour") >= 1
            && p.paints("webgpu") >= 5
            && p.paints("dot") >= 5
            && p.title("webgpu").is_some_and(|t| t.contains("gpu:"))
    });
    // A still page paints once or twice; give the WebGPU page a few frames more.
    probe.pump_for(Duration::from_millis(300));
    json!({
        "scenario": "import",
        "started": started,
        "software": std::env::var_os("DESK_SURFACE_SOFTWARE").is_some(),
        "expected": { "colour": super::pages::COLOUR, "webgpu": super::pages::WEBGPU },
        "surfaces": { "colour": surface(probe, "colour"), "webgpu": surface(probe, "webgpu"), "dot": surface(probe, "dot") },
        "relayed": probe.host.relay().counts(),
    })
}

/// Twenty animating surfaces made hidden, then shown together: none paints while hidden, and every
/// one paints again once shown (only ten did before `WasResized` followed `WasHidden(false)`).
pub fn many(probe: &mut Probe) -> Value {
    let ids: Vec<String> = (0..20).map(|i| format!("m{i}")).collect();
    for id in &ids {
        probe.host.load(id, &super::pages::url("probe.anim"));
        probe.send(json!({ "type": "create", "surface": id, "plugin": "probe.anim", "view": "main",
            "size": { "width": 200, "height": 100 }, "scale": 2, "format": "bgra8", "hidden": true }));
    }
    probe.pump_until(START, |p| ids.iter().all(|id| p.title(id).is_some()));
    probe.pump_for(Duration::from_millis(1500));
    let hidden: Vec<u64> = ids.iter().map(|id| probe.paints(id)).collect();
    for id in &ids {
        probe.send(json!({ "type": "show", "surface": id }));
    }
    probe.pump_for(Duration::from_secs(2));
    let shown: Vec<u64> = ids.iter().map(|id| probe.paints(id)).collect();
    let renderers = super::renderers().map(|r| r.len());
    json!({ "scenario": "many", "hidden": hidden, "shown": shown, "renderers": renderers })
}

pub fn lifecycle(probe: &mut Probe) -> Value {
    for (id, plugin) in [
        ("a", "probe.anim"),
        ("b", "probe.webgpu"),
        ("c", "probe.colour"),
    ] {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        ["a", "b", "c"]
            .iter()
            .all(|s| p.pid(s).is_some() && p.paints(s) >= 1)
            && p.paints("b") >= 10
    });
    let pids: Vec<Option<u32>> = ["a", "b", "c"].iter().map(|s| probe.pid(s)).collect();
    let renderers_before = renderers().map(|r| r.len());

    // Hidden: after a moment for a frame already on its way, no paint at all.
    probe.send(json!({ "type": "hide", "surface": "a" }));
    let f0 = probe.begin_frames("a");
    probe.pump_for(Duration::from_millis(300));
    let (a0, b0) = (probe.paints("a"), probe.paints("b"));
    probe.pump_for(Duration::from_millis(1500));
    let hidden = json!({ "hidden_paints": probe.paints("a") - a0, "other_paints": probe.paints("b") - b0,
        "begin_frames": probe.begin_frames("a") - f0 });
    probe.send(json!({ "type": "show", "surface": "a" }));
    let a1 = probe.paints("a");
    probe.pump_for(Duration::from_millis(800));
    let shown = probe.paints("a") - a1;

    // Paced: the compositor's hint caps the frame rate (the engine's windowless frame rate).
    probe.send(json!({ "type": "pace", "surface": "a", "fps": 10 }));
    probe.pump_for(Duration::from_millis(300));
    let a2 = probe.paints("a");
    probe.pump_for(Duration::from_millis(2000));
    let paced = (probe.paints("a") - a2) as f64 / 2.0;
    probe.send(json!({ "type": "pace", "surface": "a", "fps": 60 }));

    // The desk's frame clock (#111): held, no begin frame goes out and an animating page paints
    // nothing once what was on its way has come; let go, it paints again.
    probe.pump_for(Duration::from_millis(300));
    probe.hold(true);
    probe.pump_for(Duration::from_millis(300));
    let a4 = probe.paints("a");
    probe.pump_for(Duration::from_millis(1000));
    let held_paints = probe.paints("a") - a4;
    probe.hold(false);
    let a5 = probe.paints("a");
    probe.pump_for(Duration::from_millis(500));
    let clock = json!({ "held_paints": held_paints, "paints_after": probe.paints("a") - a5 });

    // Asleep: the browser closes and its renderer exits.
    let b_pid = probe.pid("b");
    probe.send(json!({ "type": "sleep", "surface": "b" }));
    let fb = probe.begin_frames("b");
    let closed = probe.pump_until(Duration::from_secs(5), |p| p.host.browser("b").is_none());
    let gone = probe.pump_until(Duration::from_secs(5), |_| {
        b_pid.and_then(alive) != Some(true)
    });
    let asleep = json!({
        "browser": probe.host.browser("b").is_some(),
        "closed": closed,
        "renderer_alive": b_pid.and_then(alive),
        "renderer_gone_in_time": gone,
        "renderers": renderers().map(|r| r.len()),
        "begin_frames": probe.begin_frames("b") - fb,
    });
    let slept_paints = probe.paints("b");
    let size = json!({ "width": SIZE.0, "height": SIZE.1 });
    probe.send(json!({ "type": "wake", "surface": "b", "size": size, "scale": 2 }));
    let woke = probe.pump_until(START, |p| {
        p.paints("b") > slept_paints + 5 && p.pid("b") != b_pid
    });

    // Death: one renderer killed; only its surface dies, the others keep painting.
    let c_pid = probe.pid("c");
    let (a3, b3) = (probe.paints("a"), probe.paints("b"));
    let killed = c_pid.is_some_and(kill);
    let noticed = probe.pump_until(Duration::from_secs(5), |p| !p.deaths().is_empty());
    probe.pump_for(Duration::from_millis(1000));
    let during = json!({ "a": probe.paints("a") - a3, "b": probe.paints("b") - b3 });
    let dead_state = probe.host.counts("c").map(|(_, s, _)| format!("{s:?}"));
    let c_paints = probe.paints("c");
    probe.send(json!({ "type": "wake", "surface": "c", "size": size, "scale": 2 }));
    let reloaded = probe.pump_until(START, |p| {
        p.paints("c") > c_paints && p.pid("c").is_some() && p.pid("c") != c_pid
    });

    json!({
        "scenario": "lifecycle",
        "started": started,
        "pids": pids,
        "renderers_before": renderers_before,
        "hidden": hidden,
        "shown_paints": shown,
        "paced_fps": paced,
        "clock": clock,
        "asleep": asleep,
        "woke": woke,
        "death": {
            "killed": killed,
            "noticed": noticed,
            "deaths": probe.deaths(),
            "others_painted": during,
            "state": dead_state,
            "reloaded": reloaded,
            "new_pid": probe.pid("c"),
        },
        "surfaces": { "a": surface(probe, "a"), "b": surface(probe, "b"), "c": surface(probe, "c") },
    })
}
