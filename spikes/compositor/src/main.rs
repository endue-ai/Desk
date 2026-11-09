//! Spike for #33 (P1), #34 (P2) and #35 (P3): N off-screen CEF browsers, each its own renderer,
//! whose shared-texture paints a wgpu compositor draws as tilted quads over its own background.
//! Throwaway code: see README.md for how to run it and what it measured.

mod cef_app;
mod compositor;
mod options;
mod server;
mod surfaces;

use cef::{CefString, ImplBrowser, ImplBrowserHost, ImplCommandLine};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::{Ime, WindowEvent};
use winit::event_loop::{ActiveEventLoop, EventLoop};
use winit::platform::pump_events::{EventLoopExtPumpEvents, PumpStatus};
use winit::window::{Window, WindowId};

struct Shell {
    compositor: compositor::Compositor,
    headless: bool,
    window: Option<Arc<Window>>,
    browsers: Rc<RefCell<Vec<cef::Browser>>>,
    exit: bool,
}

impl ApplicationHandler for Shell {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() || std::env::var_os("SPIKE_NO_WINDOW").is_some() {
            return;
        }
        let (w, h) = self.compositor.size;
        let attributes = Window::default_attributes()
            .with_title("Desk compositor spike")
            .with_inner_size(winit::dpi::PhysicalSize::new(w, h));
        let window = Arc::new(event_loop.create_window(attributes).expect("a window"));
        window.set_ime_allowed(true);
        if !self.headless {
            self.compositor.attach_window(window.clone());
        }
        self.window = Some(window);
    }

    fn window_event(&mut self, _loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::CloseRequested => self.exit = true,
            WindowEvent::Resized(size) => self.compositor.resize_window(size.width, size.height),
            // The real OS input method: forward composition and commit to surface 0.
            WindowEvent::Ime(ime) => {
                let browsers = self.browsers.borrow();
                let Some(host) = browsers.first().and_then(|b| b.host()) else {
                    return;
                };
                match ime {
                    Ime::Preedit(text, _) => set_composition(&host, &text),
                    Ime::Commit(text) => commit(&host, &text),
                    Ime::Enabled | Ime::Disabled => {}
                }
            }
            _ => {}
        }
    }
}

const NO_RANGE: cef::Range = cef::Range {
    from: u32::MAX,
    to: u32::MAX,
};

fn set_composition(host: &cef::BrowserHost, text: &str) {
    let len = text.encode_utf16().count() as u32;
    let selection = cef::Range { from: len, to: len };
    host.ime_set_composition(
        Some(&CefString::from(text)),
        None,
        Some(&NO_RANGE),
        Some(&selection),
    );
}

fn commit(host: &cef::BrowserHost, text: &str) {
    host.ime_commit_text(Some(&CefString::from(text)), Some(&NO_RANGE), 0);
}

fn main() -> std::process::ExitCode {
    #[cfg(target_os = "macos")]
    let _loader = {
        let loader =
            cef::library_loader::LibraryLoader::new(&std::env::current_exe().unwrap(), false);
        assert!(loader.load(), "the CEF framework loads");
        loader
    };
    let _ = cef::api_hash(cef::sys::CEF_API_VERSION_LAST, 0);

    let options = options::Options::parse();
    if std::env::var_os("SPIKE_SKIP_CEF").is_some() {
        // Diagnostics: the compositor alone, no CEF at all.
        let mut compositor = compositor::Compositor::new(options.frame);
        let start = Instant::now();
        while start.elapsed().as_secs_f32() < options.exit_at {
            let t = start.elapsed().as_secs_f32();
            if std::env::var_os("SPIKE_IDLE").is_none() {
                let transforms = compositor.layout(0, options.view, 0.0, t);
                compositor.render(&transforms, t);
            }
            let pause = if std::env::var_os("SPIKE_SLOW").is_some() {
                1000
            } else {
                16
            };
            std::thread::sleep(Duration::from_millis(pause));
        }
        println!(
            "SPIKE-REPORT compositor only composed={}",
            compositor.composed
        );
        return std::process::ExitCode::SUCCESS;
    }
    let args = cef::args::Args::new();
    let cmd = args.as_cmd_line().expect("a command line");
    let is_browser = cmd.has_switch(Some(&CefString::from("type"))) != 1;
    let due: cef_app::PumpDue = Rc::new(std::cell::Cell::new(Instant::now()));
    let mut app = cef_app::SpikeApp::new(options.switches.clone(), due.clone());
    let code = cef::execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if !is_browser {
        return (code.max(0) as u8).into();
    }

    let cache = std::env::temp_dir().join(format!("desk-spike-{}", std::process::id()));
    let settings = cef::Settings {
        windowless_rendering_enabled: 1,
        external_message_pump: 1,
        no_sandbox: 1,
        root_cache_path: cache.to_string_lossy().as_ref().into(),
        log_severity: cef::LogSeverity::WARNING,
        ..Default::default()
    };
    assert_eq!(
        cef::initialize(
            Some(args.as_main_args()),
            Some(&settings),
            Some(&mut app),
            std::ptr::null_mut()
        ),
        1,
        "CEF initialises"
    );

    let port = server::start();
    let compositor = compositor::Compositor::new(options.frame);
    println!(
        "spike: pid {} adapter {} port {port}",
        std::process::id(),
        compositor.adapter_name()
    );
    let shared: surfaces::SharedRc = Rc::new(RefCell::new(surfaces::Shared {
        device: compositor.device.clone(),
        queue: compositor.queue.clone(),
        view: options.view,
        scale: options.scale,
        start: Instant::now(),
        slots: vec![],
    }));
    let browsers = Rc::new(RefCell::new(vec![]));
    let mut shell = Shell {
        compositor,
        headless: options.headless,
        window: None,
        browsers: browsers.clone(),
        exit: false,
    };
    shell.compositor.ensure_quads(options.surfaces);

    let mut event_loop = EventLoop::new().expect("an event loop");
    let start = Instant::now();
    for i in 0..options.surfaces {
        let url = format!("http://s{i}.localhost:{port}/{}.html", options.page);
        let index = shared.borrow_mut().add(url);
        let browser = surfaces::create(&shared, index, 60);
        browsers.borrow_mut().push(browser);
    }
    println!(
        "spike: created {} browsers in {:?}",
        options.surfaces,
        start.elapsed()
    );

    let frame = Duration::from_micros(16_667);
    let mut next_frame = Instant::now();
    let mut captured = 0;
    let mut killed = false;
    let mut resized = false;
    let mut view = options.view;
    let mut ime_step = 0usize;
    let mut ime_next = Instant::now();
    let mut spent = [Duration::ZERO; 3];
    let mut calls = 0u64;
    let mut slow = 0u64;
    let mut longest = Duration::ZERO;
    loop {
        let a = Instant::now();
        if a >= due.get() {
            // Run CEF's work only when it asked for it (or after the longest delay).
            due.set(a + cef_app::MAX_PUMP_DELAY);
            cef::do_message_loop_work();
        }
        let b = Instant::now();
        if let PumpStatus::Exit(_) = event_loop.pump_app_events(Some(Duration::ZERO), &mut shell) {
            break;
        }
        let c = Instant::now();
        spent[0] += b - a;
        if b - a > Duration::from_micros(50) {
            calls += 1;
        }
        if b - a > Duration::from_millis(10) {
            slow += 1;
        }
        longest = longest.max(b - a);
        spent[1] += c - b;
        let now = Instant::now();
        let t = (now - start).as_secs_f32();

        let reloads: Vec<usize> = shared
            .borrow_mut()
            .slots
            .iter_mut()
            .enumerate()
            .filter_map(|(i, s)| std::mem::take(&mut s.reload_requested).then_some(i))
            .collect();
        for i in reloads {
            println!("[{t:6.2}s] surface {i}: reloading after the renderer died");
            browsers.borrow()[i].reload();
        }

        if now >= next_frame {
            for browser in browsers.borrow().iter() {
                if let Some(host) = browser.host() {
                    host.send_external_begin_frame();
                }
            }
            {
                let shared = shared.borrow();
                for (i, slot) in shared.slots.iter().enumerate() {
                    if let Some(texture) = &slot.texture {
                        shell.compositor.update_texture(i, slot.generation, texture);
                        if slot.generation % 120 == 1 {
                            let size = texture.size();
                            println!(
                                "[{t:6.2}s] surface {i}: texture {}x{}",
                                size.width, size.height
                            );
                        }
                    }
                }
            }
            let transforms = shell
                .compositor
                .layout(options.surfaces, view, options.tilt, t);
            let r = Instant::now();
            shell.compositor.render(&transforms, t);
            spent[2] += r.elapsed();
            next_frame += frame;
            if next_frame < now {
                next_frame = now + frame;
            }
        }

        if captured < options.capture_at.len() && t >= options.capture_at[captured] {
            let path = format!("{}-{captured}.png", options.capture);
            match shell.compositor.capture(&path) {
                Ok(()) => println!("[{t:6.2}s] captured {path}"),
                Err(error) => eprintln!("spike: capture failed: {error}"),
            }
            captured += 1;
        }

        if !resized && options.resize_at.is_some_and(|r| t >= r) {
            resized = true;
            view = options.resize_to;
            shared.borrow_mut().view = view;
            for browser in browsers.borrow().iter() {
                if let Some(host) = browser.host() {
                    host.was_resized();
                }
            }
            println!("[{t:6.2}s] resized every view to {}x{}", view.0, view.1);
        }

        if !killed && options.kill_at.is_some_and(|k| t >= k) {
            killed = true;
            kill_one_renderer(t);
        }

        if options.ime_script && ime_step < IME_STEPS.len() && now >= ime_next {
            let ready = shared
                .borrow()
                .slots
                .first()
                .is_some_and(|s| s.console.iter().any(|l| l.contains("ready ime")));
            if ready {
                if let Some(host) = browsers.borrow().first().and_then(|b| b.host()) {
                    run_ime_step(&host, ime_step, t);
                }
                ime_step += 1;
                ime_next = now + Duration::from_millis(150);
            }
        }

        if shell.exit || t >= options.exit_at {
            break;
        }
        std::thread::sleep(Duration::from_millis(1));
    }

    println!(
        "SPIKE-REPORT loop cef_work={:?} winit_pump={:?} render={:?} calls={calls} slow={slow} longest={longest:?}",
        spent[0], spent[1], spent[2]
    );
    report(&shared, &shell.compositor, start.elapsed());
    for browser in browsers.borrow().iter() {
        if let Some(host) = browser.host() {
            host.close_browser(1);
        }
    }
    for _ in 0..50 {
        cef::do_message_loop_work();
        std::thread::sleep(Duration::from_millis(5));
    }
    browsers.borrow_mut().clear();
    cef::shutdown();
    let _ = std::fs::remove_dir_all(&cache);
    std::process::ExitCode::SUCCESS
}

/// A Korean composition, syllable by syllable, as macOS's 2-set input method sends it.
const IME_STEPS: &[&str] = &["focus", "ㅎ", "하", "한", "=한", "ㄱ", "그", "글", "=글"];

fn run_ime_step(host: &cef::BrowserHost, step: usize, t: f32) {
    let action = IME_STEPS[step];
    println!("[{t:6.2}s] ime step {step}: {action}");
    if action == "focus" {
        host.set_focus(1);
        let at = cef::MouseEvent {
            x: 300,
            y: 72,
            modifiers: 0,
        };
        host.send_mouse_click_event(Some(&at), cef::MouseButtonType::LEFT, 0, 1);
        host.send_mouse_click_event(Some(&at), cef::MouseButtonType::LEFT, 1, 1);
    } else if let Some(text) = action.strip_prefix('=') {
        commit(host, text);
    } else {
        set_composition(host, action);
    }
}

/// Kill the first renderer child of this process with SIGKILL, as a crash would.
fn kill_one_renderer(t: f32) {
    let me = std::process::id().to_string();
    let output = std::process::Command::new("ps")
        .args(["-ax", "-o", "pid=,ppid=,command="])
        .output();
    let Ok(output) = output else { return };
    let text = String::from_utf8_lossy(&output.stdout);
    let victim = text.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let pid = parts.next()?;
        let ppid = parts.next()?;
        (ppid == me && line.contains("--type=renderer")).then(|| pid.to_owned())
    });
    match victim {
        Some(pid) => {
            println!("[{t:6.2}s] killing renderer pid {pid}");
            let _ = std::process::Command::new("kill")
                .args(["-9", &pid])
                .status();
        }
        None => println!("[{t:6.2}s] no renderer child found to kill"),
    }
}

fn report(shared: &surfaces::SharedRc, compositor: &compositor::Compositor, elapsed: Duration) {
    let shared = shared.borrow();
    let secs = elapsed.as_secs_f64();
    println!(
        "SPIKE-REPORT elapsed={secs:.2}s composed={} ({:.1} fps) presented={}",
        compositor.composed,
        compositor.composed as f64 / secs,
        compositor.presented
    );
    for (i, slot) in shared.slots.iter().enumerate() {
        let avg = if slot.paints > 0 {
            slot.import_time.as_secs_f64() * 1000.0 / slot.paints as f64
        } else {
            0.0
        };
        println!(
            "SPIKE-REPORT surface={i} first_paint_ms={} paints={} paints_per_s={:.1} software_paints={} import_errors={} import_ms_avg={avg:.2} terminated={:?} ime_bounds={}",
            slot.first_paint
                .map(|d| d.as_millis().to_string())
                .unwrap_or_else(|| "-".into()),
            slot.paints,
            slot.paints as f64 / secs,
            slot.software_paints,
            slot.import_errors,
            slot.terminated,
            slot.ime_bounds.last().cloned().unwrap_or_default(),
        );
    }
}
