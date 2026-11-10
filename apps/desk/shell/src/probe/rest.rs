//! The desk at rest (#129): three still surfaces, shown and awake, that nobody touches. Once each
//! is long idle (`web_host/frames.rs`), the probe runs its loop as the compositor window's event
//! loop runs (`Probe::rest_for`: a turn, then a wait for CEF's next work, the clock's next look or
//! CEF's ask, nothing else) and counts what a desk at rest costs: its loop's wake-ups and CEF's
//! work calls among them a second, the time those took and how many took 5 ms or more, the begin
//! frames and paints, and the CPU and OS wake-ups of the browser process (where the desk's loop
//! runs), the GPU process and the renderers. What a press from rest takes is the `idle-input`
//! run's (#133, `idle_input.rs`). `tests/budgets.rs` judges them through `just perf-compositor`.

use std::time::{Duration, Instant};

use serde_json::{Value, json};

use super::Probe;
use super::desk_loop::tree;
use crate::pump::Counts;

const SIZE: (u32, u32) = (320, 200);
const START: Duration = Duration::from_secs(20);
/// Longer than a surface takes to be long idle, so the clock runs at its rest rate throughout.
const SETTLE: Duration = Duration::from_secs(3);
/// How long the rest is measured.
const MEASURE: Duration = Duration::from_secs(10);
const SURFACES: [(&str, &str); 3] = [
    ("a", "probe.colour"),
    ("b", "probe.colour"),
    ("click", "probe.click"),
];

/// A process's CPU time in seconds so far, and the times the OS woke it from idle (macOS only).
#[derive(Clone, Copy, Debug)]
struct Usage {
    cpu: f64,
    wakeups: Option<u64>,
}

impl std::ops::Add for Usage {
    type Output = Usage;
    fn add(self, other: Usage) -> Usage {
        Usage {
            cpu: self.cpu + other.cpu,
            wakeups: self.wakeups.zip(other.wakeups).map(|(a, b)| a + b),
        }
    }
}

/// A process's usage: its CPU time (`ps`), and on macOS the package idle and interrupt wake-ups
/// Activity Monitor counts (`proc_pid_rusage`).
fn usage(pid: u32) -> Option<Usage> {
    Some(Usage {
        cpu: super::desk_loop::cpu_seconds(pid)?,
        wakeups: wakeups(pid),
    })
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn wakeups(pid: u32) -> Option<u64> {
    let mut info = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
    // SAFETY: with RUSAGE_INFO_V2 the call writes one `rusage_info_v2` into the buffer it is given.
    let wrote = unsafe {
        libc::proc_pid_rusage(
            i32::try_from(pid).ok()?,
            libc::RUSAGE_INFO_V2,
            info.as_mut_ptr().cast(),
        )
    };
    // SAFETY: written above; zeroed before, so every field is initialised either way.
    let info = unsafe { info.assume_init() };
    (wrote == 0).then(|| info.ri_pkg_idle_wkups + info.ri_interrupt_wkups)
}

#[cfg(not(target_os = "macos"))]
fn wakeups(_pid: u32) -> Option<u64> {
    None
}

/// The usage of every process of `kind` in this process's tree (`browser` is this one).
fn usage_of(kind: &str) -> Option<Usage> {
    tree()
        .iter()
        .filter(|(_, k)| k == kind)
        .map(|(pid, _)| usage(*pid))
        .try_fold(
            Usage {
                cpu: 0.0,
                wakeups: Some(0),
            },
            |sum, u| Some(sum + u?),
        )
}

/// What the desk had done by a moment.
struct Sample {
    at: Instant,
    counts: Counts,
    begin_frames: u64,
    paints: u64,
    desk: Option<Usage>,
    gpu: Option<Usage>,
    renderers: Option<Usage>,
}

impl Sample {
    fn now(probe: &Probe) -> Sample {
        let ids = SURFACES.map(|(id, _)| id);
        Sample {
            at: Instant::now(),
            counts: probe.pump.counts(),
            begin_frames: ids.iter().map(|s| probe.begin_frames(s)).sum(),
            paints: ids.iter().map(|s| probe.paints(s)).sum(),
            desk: usage_of("browser"),
            gpu: usage_of("gpu-process"),
            renderers: usage_of("renderer"),
        }
    }
}

fn round(value: f64, places: i32) -> f64 {
    let scale = 10f64.powi(places);
    (value * scale).round() / scale
}

/// What a second of the stretch from `a` to `b` cost.
fn per_second(a: &Sample, b: &Sample) -> Value {
    let seconds = (b.at - a.at).as_secs_f64();
    let rate = |n: u64| round(n as f64 / seconds, 1);
    let percent = |a: Option<Usage>, b: Option<Usage>| {
        a.zip(b)
            .map(|(a, b)| round((b.cpu - a.cpu) / seconds * 100.0, 1))
    };
    let wakeups = |a: Option<Usage>, b: Option<Usage>| {
        let (a, b) = (a?.wakeups?, b?.wakeups?);
        Some(rate(b.saturating_sub(a)))
    };
    let work = b.counts.work.saturating_sub(a.counts.work);
    json!({
        "seconds": round(seconds, 2),
        "turns_per_s": rate(b.counts.turns - a.counts.turns),
        "works_per_s": rate(b.counts.works - a.counts.works),
        "work_ms_per_s": round(work.as_secs_f64() * 1000.0 / seconds, 2),
        "long_works": b.counts.long - a.counts.long,
        "begin_frames_per_s": rate(b.begin_frames - a.begin_frames),
        "paints_per_s": rate(b.paints - a.paints),
        "cpu_percent": percent(a.desk, b.desk),
        "os_wakeups_per_s": wakeups(a.desk, b.desk),
        "gpu_cpu_percent": percent(a.gpu, b.gpu),
        "renderers_cpu_percent": percent(a.renderers, b.renderers),
    })
}

pub fn rest(probe: &mut Probe) -> Value {
    for (id, plugin) in SURFACES {
        probe.create(id, plugin, SIZE);
    }
    let started = probe.pump_until(START, |p| {
        SURFACES
            .iter()
            .all(|(s, _)| p.pid(s).is_some() && p.paints(s) >= 1)
    });
    probe.rest_for(SETTLE);
    let before = Sample::now(probe);
    probe.rest_for(MEASURE);
    let after = Sample::now(probe);
    json!({
        "scenario": "rest",
        "started": started,
        "rest": per_second(&before, &after),
    })
}
