//! The surface probe (#52): `endue-desk --surface-probe=<scenario>` runs the web host
//! and the compositor's import entry on the probe's pages (`probe/pages.rs`) without a window or a
//! desk, prints one `SURFACE-PROBE {json}` line and exits. `tests/osr_import.rs` and
//! `tests/lifecycle.rs` run it: a known colour and WebGPU through the shared texture (or the software
//! path), a hidden surface that paints nothing, a sleeping one without a renderer, a killed renderer
//! that is the only one to die. The compositor's gates (#58, `gates.rs`) run a desk loop over the
//! surfaces (`desk_loop.rs`): a busy or killed renderer beside others, a surface at a memory cap, the
//! memory per live surface and the start to the first composed web surface; `tests/isolation.rs`
//! and `tests/budgets.rs` judge them. The `a11y` run (#57, `a11y.rs`) exports a page's tree, merged
//! as the compositor merges it, and does a screen reader's actions on it; `tests/a11y.rs` judges it.
//! The `rest` run (#129, `rest.rs`) counts what a desk at rest costs, its loop run as the window's.
//! `DESK_PROBE_TRACE=<file>` writes Chromium's trace of any run (#117, `trace.rs`). Development use
//! only; it never opens the person's data folder.

mod a11y;
mod desk_loop;
mod gates;
mod input_gate;
pub mod pages;
mod rest;
mod scenarios;
mod trace;

use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use desk_compositor::{Compositor, Rect, Scene, SurfaceNode};
use desk_surface::generated::{CompositorMessage, SurfaceMessage};
use serde_json::{Value, json};

use crate::app::ShellApp;
use crate::compositor_window::composed::Shared;
use crate::plugin_scheme::{self, Files};
use crate::pump::Pump;
use crate::web_host::WebHost;
use crate::web_host::relay::Relay;

/// The longest a probe step waits: the desk's frames are due on their own cadence too.
const STEP: Duration = Duration::from_millis(1);

/// The command-line flag, `--surface-probe=<scenario>`.
pub const FLAG: &str = "--surface-probe=";

/// The scenario this start asks for, if any.
pub fn requested() -> Option<String> {
    std::env::args().find_map(|a| a.strip_prefix(FLAG).map(str::to_owned))
}

/// The probe's running parts.
pub struct Probe {
    pump: Pump,
    pub host: WebHost,
    pub shared: Shared,
    titles: std::collections::HashMap<String, String>,
    deaths: Vec<Value>,
    /// When CEF was up and when the compositor was, in ms since the Unix epoch (the start gate
    /// compares them with when its test started the probe).
    pub cef_ready: f64,
    pub gpu_ready: f64,
    /// The desk's frame clock is held: no begin frame goes out (the `lifecycle` run's check that
    /// surfaces render only on it), from the probe's loop or the pump's stand-in (#129).
    held: Arc<AtomicBool>,
    /// Each surface's accessibility tree, merged from its `a11y.update`s (#57).
    pub a11y: std::collections::HashMap<String, desk_compositor::a11y::SurfaceTree>,
    /// How many `a11y.update`s came.
    pub a11y_updates: u64,
}

/// Now, in ms since the Unix epoch: a clock another process can compare with.
pub fn epoch_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs_f64() * 1000.0)
}

/// Run `scenario` in this (browser) process; CEF is not initialised yet.
pub fn run(args: &cef::args::Args, scenario: &str) -> ExitCode {
    let pump = Pump::new(None);
    pump.wake_thread(std::thread::current());
    let mut app = ShellApp::browser(pump.clone(), crate::paths::dist());
    let root = std::env::temp_dir().join(format!("desk-surface-probe-{}", std::process::id()));
    let settings = cef::Settings {
        windowless_rendering_enabled: 1,
        external_message_pump: 1,
        no_sandbox: 1,
        root_cache_path: root.to_string_lossy().as_ref().into(),
        log_severity: cef::LogSeverity::ERROR,
        ..Default::default()
    };
    if cef::initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    ) != 1
    {
        eprintln!("surface probe: CEF did not start");
        return ExitCode::FAILURE;
    }
    plugin_scheme::register_files(Files::Probe);
    let cef_ready = epoch_ms();
    let report = match desk_compositor::headless::headless_device() {
        Ok(gpu) => {
            let compositor =
                Compositor::new(&gpu.device, &gpu.queue, wgpu::TextureFormat::Bgra8Unorm);
            let shared = Shared::new(compositor);
            let host = WebHost::new(Arc::new(shared.clone()), Relay::default(), None);
            let mut probe = Probe {
                pump,
                host,
                shared,
                titles: Default::default(),
                deaths: Vec::new(),
                cef_ready,
                gpu_ready: epoch_ms(),
                held: Arc::default(),
                a11y: Default::default(),
                a11y_updates: 0,
            };
            probe.stand_in();
            let tracing = trace::begin(&mut probe);
            let mut report = match scenario {
                "import" => scenarios::import(&mut probe),
                "lifecycle" => scenarios::lifecycle(&mut probe),
                "many" => scenarios::many(&mut probe),
                "isolation" => gates::isolation(&mut probe),
                "cap" => gates::cap(&mut probe),
                "memory" => gates::memory(&mut probe),
                "startup" => gates::startup(&mut probe),
                "input" => input_gate::input(&mut probe),
                "a11y" => a11y::a11y(&mut probe),
                "rest" => rest::rest(&mut probe),
                other => json!({ "error": format!("no scenario {other}") }),
            };
            if let Some(file) = tracing {
                trace::end(&mut probe, &file);
            }
            report["adapter"] = json!(format!("{} ({:?})", gpu.adapter.name, gpu.adapter.backend));
            report["adapter_type"] = json!(format!("{:?}", gpu.adapter.device_type));
            probe.host.close_all();
            probe.pump_until(Duration::from_secs(5), |p| p.host.browsers() == 0);
            report
        }
        Err(why) => json!({ "error": format!("no GPU device: {why}") }),
    };
    println!("SURFACE-PROBE {report}");
    cef::shutdown();
    let _ = std::fs::remove_dir_all(&root);
    ExitCode::SUCCESS
}

impl Probe {
    /// Run CEF's work as it asks for it, for `time`.
    pub fn pump_for(&mut self, time: Duration) {
        let until = Instant::now() + time;
        while Instant::now() < until {
            self.step();
        }
    }

    /// Run CEF's work until `done` or `timeout`; whether `done` came.
    pub fn pump_until(&mut self, timeout: Duration, done: impl Fn(&Probe) -> bool) -> bool {
        let until = Instant::now() + timeout;
        while Instant::now() < until {
            if done(self) {
                return true;
            }
            self.step();
        }
        done(self)
    }

    /// CEF's work when it is due and the frame clock's begin frames, as the compositor window runs
    /// them (#111), then a wait until either is due again or CEF asks, at most `STEP`.
    fn step(&mut self) {
        let until = self.work();
        Probe::wait(until);
    }

    /// Wait until `until`, or until CEF asks for its work.
    fn wait(until: Instant) {
        std::thread::park_timeout(until.saturating_duration_since(Instant::now()));
    }

    /// CEF's work when it is due and the frame clock's begin frames; when to look again, at most
    /// `STEP` from now.
    fn work(&mut self) -> Instant {
        self.look().min(Instant::now() + STEP)
    }

    /// Run the desk as the compositor window's event loop does at rest, for `time`: a turn, then a
    /// wait until CEF's work or the clock's next look is due, or CEF asks (#129, `rest.rs`).
    pub fn rest_for(&mut self, time: Duration) {
        let end = Instant::now() + time;
        while Instant::now() < end {
            let until = self.look();
            Probe::wait(until.min(end));
        }
    }

    /// Hold the desk's frame clock, or let it go.
    pub fn hold(&self, held: bool) {
        self.held.store(held, Ordering::SeqCst);
    }

    /// The pump's stand-in looks at the probe's clock while CEF's work runs long, as the
    /// compositor window's does (#129, `pump/stand_in.rs`).
    fn stand_in(&self) {
        let (host, held) = (self.host.clone(), Arc::clone(&self.held));
        let look = move |now| {
            (!held.load(Ordering::SeqCst))
                .then(|| host.begin_frames(now))
                .flatten()
        };
        self.pump
            .stand_in(Arc::new(look), Arc::new(crate::web_host::frames::prompted));
    }

    /// One turn of the desk's loop: CEF's work when it is due and the frame clock's begin frames;
    /// when either is due next, CEF's poll riding the clock's next look (`pump.rs`).
    fn look(&mut self) -> Instant {
        self.pump.turn(Instant::now());
        let now = Instant::now();
        let clock = (!self.held.load(Ordering::SeqCst))
            .then(|| self.host.begin_frames(now))
            .flatten();
        self.pump.looked(now, clock);
        let messages = std::mem::take(&mut self.shared.lock().messages);
        for message in messages {
            match message {
                SurfaceMessage::SurfaceTitle(t) => {
                    self.titles.insert(t.surface, t.title);
                }
                SurfaceMessage::SurfaceDied(d) => self.deaths.push(json!(d)),
                SurfaceMessage::SurfaceA11yUpdate(u) => {
                    self.a11y_updates += 1;
                    self.a11y.entry(u.surface.clone()).or_default().apply(u);
                }
                _ => {}
            }
        }
        self.pump.wake_at(clock)
    }

    /// Tell the host `message`, given as JSON.
    pub fn send(&self, message: Value) {
        match serde_json::from_value::<CompositorMessage>(message) {
            Ok(message) => self.host.send(&message),
            Err(why) => eprintln!("surface probe: not a message ({why})"),
        }
    }

    /// Make surface `surface` of probe plugin `plugin`, `size` logical pixels at scale 2.
    pub fn create(&self, surface: &str, plugin: &str, size: (u32, u32)) {
        self.host.load(surface, &pages::url(plugin));
        self.send(
            json!({ "type": "create", "surface": surface, "plugin": plugin, "view": "main",
            "size": { "width": size.0, "height": size.1 }, "scale": 2, "format": "bgra8" }),
        );
    }

    /// The begin frames the clock sent `surface` so far.
    pub fn begin_frames(&self, surface: &str) -> u64 {
        self.host
            .counts(surface)
            .map_or(0, |(c, _, _)| c.begin_frames)
    }

    /// Shared-texture and software paints of `surface` so far.
    pub fn paints(&self, surface: &str) -> u64 {
        self.host
            .counts(surface)
            .map_or(0, |(c, _, _)| c.paints + c.software_paints)
    }

    pub fn title(&self, surface: &str) -> Option<&str> {
        self.titles.get(surface).map(String::as_str)
    }

    /// The renderer process id `surface`'s page put in its title.
    pub fn pid(&self, surface: &str) -> Option<u32> {
        let title = self.title(surface)?;
        title
            .split_whitespace()
            .find_map(|w| w.strip_prefix("pid:"))?
            .parse()
            .ok()
            .filter(|p| *p > 0)
    }

    pub fn deaths(&self) -> &[Value] {
        &self.deaths
    }

    /// The colour of the pixel at the middle of `surface`'s frame, as the compositor draws it.
    pub fn middle(&self, surface: &str) -> Option<[u8; 4]> {
        let mut composed = self.shared.lock();
        let id = composed.texture_of(surface)?;
        let (w, h) = composed.frames.size(id)?;
        let mut scene = Scene::new(w, h);
        let whole = Rect::new(0.0, 0.0, w as f32, h as f32);
        scene
            .insert(scene.root(), SurfaceNode::new(whole, id))
            .ok()?;
        let rgba = composed.read(&scene)?;
        let i = (((h / 2) * w + w / 2) * 4) as usize;
        rgba.get(i..i + 4).map(|p| [p[0], p[1], p[2], p[3]])
    }
}

/// The renderer processes this process started (Unix; `None` elsewhere).
pub fn renderers() -> Option<Vec<u32>> {
    if cfg!(windows) {
        return None;
    }
    let out = std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid=,command="])
        .output()
        .ok()?;
    let me = std::process::id().to_string();
    let text = String::from_utf8_lossy(&out.stdout);
    let pids = text.lines().filter_map(|line| {
        let mut parts = line.split_whitespace();
        let (pid, ppid) = (parts.next()?, parts.next()?);
        (ppid == me && line.contains("--type=renderer"))
            .then(|| pid.parse().ok())
            .flatten()
    });
    Some(pids.collect())
}

/// Whether process `pid` is alive (Unix).
pub fn alive(pid: u32) -> Option<bool> {
    if cfg!(windows) {
        return None;
    }
    let status = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stderr(std::process::Stdio::null())
        .status()
        .ok()?;
    Some(status.success())
}

/// Kill process `pid` as a crash would (SIGKILL; Unix).
pub fn kill(pid: u32) -> bool {
    !cfg!(windows)
        && std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .status()
            .is_ok_and(|s| s.success())
}
