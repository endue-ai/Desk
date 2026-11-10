//! The session: take the seat, the card and an output, put a present path on it, build the desk,
//! then loop: poll input and flip events, follow the seat (VT switches), route input through the
//! compositor, pump CEF, draw and flip. Quits after `--seconds` or on Ctrl+Alt+Backspace.

use crate::desk::Desk;
use crate::input::{Action, Devices, SharedSeat};
use crate::kms::{self, Card, Output};
use crate::options::{Options, PresentPath};
use crate::present::{Present, dumb::Dumb, vk_display::VkDisplay};
use crate::seat::{self, SeatEvent};
use desk_compositor::input::Out;
use drm::ClientCapability;
use drm::Device as _;
use rustix::event::{PollFd, PollFlags, Timespec};
use std::cell::RefCell;
use std::rc::Rc;
use std::time::{Duration, Instant};

pub fn run(o: Options) -> Result<(), String> {
    let seat: SharedSeat = Rc::new(RefCell::new(seat::open(o.seat)?));
    println!("seat: {}", seat.borrow().name());
    let path = match &o.device {
        Some(p) => p.clone(),
        None => kms::cards()
            .into_iter()
            .find(|p| kms::has_connected_output(p))
            .ok_or("no /dev/dri/card* with a connected output (see --list)")?,
    };
    let fd = seat
        .borrow_mut()
        .open(&path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let card = Rc::new(Card(fd));
    let _ = card.set_client_capability(ClientCapability::UniversalPlanes, true);
    let output = kms::pick(&card, o.connector.as_deref(), o.mode)?;
    let (w, h) = output.size();
    println!(
        "kms: {} {}x{} @ {} mHz on CRTC {:?} of {}",
        output.name,
        w,
        h,
        kms::refresh_mhz(&output.mode),
        output.crtc,
        path.display()
    );

    let mut present = open_present(&o, card.clone(), &output)?;
    let adapter = present.adapter();
    println!(
        "present: {} on {} ({:?}, {:?}, driver {})",
        present.describe(),
        adapter.name,
        adapter.backend,
        adapter.device_type,
        adapter.driver_info
    );
    let mut desk = Desk::new(
        present.device(),
        present.queue(),
        present.format(),
        present.size(),
        o.windows,
        o.cef_url.is_some(),
    );
    let mut devices = Devices::new(seat.clone(), present.size())?;
    #[cfg(feature = "cef")]
    let mut web = match &o.cef_url {
        Some(url) => Some(crate::web::Web::start(
            url,
            &o.cef_switches,
            o.cef_shared_texture,
            present.device(),
            present.queue(),
            desk.plugin_size,
        )?),
        None => None,
    };
    #[cfg(not(feature = "cef"))]
    if o.cef_url.is_some() {
        return Err("--cef-url needs a build with --features cef".into());
    }

    let start = Instant::now();
    let mut active = true;
    let mut captured = o.capture.is_none();
    let mut stats = Stats::default();
    'session: loop {
        let t = start.elapsed().as_secs_f32();
        if o.seconds > 0.0 && t >= o.seconds {
            break;
        }
        if wait(&*present, &devices, active) {
            present.flipped();
        }

        // Collect first: pausing closes devices through the seat, which must not be borrowed.
        let events = seat.borrow_mut().events();
        for event in events {
            match event {
                SeatEvent::Pause => {
                    present.pause();
                    devices.suspend();
                    seat.borrow_mut().paused();
                    active = false;
                }
                SeatEvent::Resume => {
                    devices.resume();
                    present.resume()?;
                    desk.compositor.invalidate();
                    active = true;
                }
            }
        }

        for action in devices.dispatch() {
            match action {
                Action::Quit => break 'session,
                Action::SwitchVt(vt) => seat.borrow_mut().switch_vt(vt),
                Action::Input(input) => {
                    if o.verbose {
                        println!(
                            "input: {}",
                            serde_json::to_string(&input).unwrap_or_default()
                        );
                    }
                    if matches!(input, desk_compositor::input::Input::PointerMoved { .. }) {
                        desk.move_cursor(devices.pointer());
                    }
                    for out in desk.route(&input) {
                        match out {
                            #[cfg(feature = "cef")]
                            Out::Send(message) => {
                                if let Some(web) = web.as_mut() {
                                    web.deliver(&message);
                                }
                            }
                            Out::DeskKey { key, .. } => {
                                println!("input: the desk's keymap took {key:?}")
                            }
                            other if o.verbose => println!("input: router said {other:?}"),
                            _ => {}
                        }
                    }
                }
            }
        }

        #[cfg(feature = "cef")]
        if let Some(web) = &web {
            web.pump();
            if let Some(texture) = web.take_paint() {
                desk.plugin_painted(&texture);
            }
        }

        if active && present.ready() {
            desk.animate(t);
            let mut drawn = None;
            present.frame(&mut |view| {
                let frame = desk.render(view);
                drawn = Some(frame.compose_time);
                frame.drawn
            })?;
            if let Some(compose) = drawn {
                stats.compose.push(compose);
            }
        }
        if !captured && t >= o.capture_at {
            captured = true;
            let file = o.capture.clone().expect("a capture path");
            match desk.capture(&file) {
                Ok(()) => println!("capture: {}", file.display()),
                Err(e) => eprintln!("capture failed: {e}"),
            }
        }
        if stats.since.elapsed() >= Duration::from_secs(2) {
            stats.report(&*present);
            #[cfg(feature = "cef")]
            if let Some(web) = &web {
                println!("{}", web.stats());
            }
        }
    }
    stats.report(&*present);
    #[cfg(feature = "cef")]
    if let Some(web) = web {
        web.shutdown();
    }
    drop(devices);
    drop(desk);
    drop(present);
    if let Ok(card) = Rc::try_unwrap(card) {
        seat.borrow_mut().close(card.0);
    }
    Ok(())
}

fn open_present(o: &Options, card: Rc<Card>, output: &Output) -> Result<Box<dyn Present>, String> {
    match o.present {
        PresentPath::VkDisplay => Ok(Box::new(VkDisplay::new(card, output, o.plane)?)),
        PresentPath::Dumb => Ok(Box::new(Dumb::new(card, output)?)),
        PresentPath::Auto => match VkDisplay::new(card.clone(), output, o.plane) {
            Ok(present) => Ok(Box::new(present)),
            Err(e) => {
                println!("present: vk-display unavailable ({e}); falling back to dumb buffers");
                Ok(Box::new(Dumb::new(card, output)?))
            }
        },
    }
}

/// Sleep until input arrives or a flip completes; not at all while a frame can be drawn.
/// Returns whether the flip fd has events (reading it otherwise could block).
fn wait(present: &dyn Present, devices: &Devices, active: bool) -> bool {
    let busy = active && present.ready();
    let timeout = Timespec {
        tv_sec: 0,
        tv_nsec: if busy { 0 } else { 8_000_000 },
    };
    let mut fds = vec![PollFd::from_borrowed_fd(devices.fd(), PollFlags::IN)];
    if let Some(fd) = present.flip_fd() {
        fds.push(PollFd::from_borrowed_fd(fd, PollFlags::IN));
    }
    let _ = rustix::event::poll(&mut fds, Some(&timeout));
    fds.get(1)
        .is_some_and(|fd| fd.revents().contains(PollFlags::IN))
}

struct Stats {
    since: Instant,
    compose: Vec<Duration>,
    flips_before: u64,
}

impl Default for Stats {
    fn default() -> Self {
        Stats {
            since: Instant::now(),
            compose: vec![],
            flips_before: 0,
        }
    }
}

impl Stats {
    fn report(&mut self, present: &dyn Present) {
        let seconds = self.since.elapsed().as_secs_f64();
        let flips = present.flips();
        let mut ms: Vec<f64> = self
            .compose
            .iter()
            .map(|d| d.as_secs_f64() * 1000.0)
            .collect();
        ms.sort_by(f64::total_cmp);
        let median = ms.get(ms.len() / 2).copied().unwrap_or(0.0);
        let p95 = ms
            .get(((ms.len() as f64 * 0.95) as usize).min(ms.len().saturating_sub(1)))
            .copied()
            .unwrap_or(0.0);
        println!(
            "frames: {} drawn, {:.1} flips/s, compose median {median:.2} ms p95 {p95:.2} ms",
            ms.len(),
            (flips - self.flips_before) as f64 / seconds.max(0.001),
        );
        self.since = Instant::now();
        self.compose.clear();
        self.flips_before = flips;
    }
}
