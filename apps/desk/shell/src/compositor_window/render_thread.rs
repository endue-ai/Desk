//! The compositor's render thread (#249, ADR 0235). The main thread lays the scene out on the
//! display's beat (`clock.rs`) and hands this thread a copy (`RenderThread::hand`); this thread
//! draws each frame behind the slot it was laid out on, by up to three quarters of a display
//! interval in a run of frames (`Behind`), so a main thread that CEF's work, a bridge call or an
//! import holds up to that long past a slot loses no frame: the main thread draws nothing, and a
//! frame it laid out is drawn on time whatever it does next. A frame from rest is drawn at once, so
//! a key's paint waits for no tick, and each frame of a run after it an eighth of an interval
//! further behind, at most, so the cadence never jumps. A scene handed for the slot of the one
//! waiting replaces it; one for the next slot waits behind it, so a frame this thread is late for
//! is drawn at once, not dropped; a frame of the pictures alone (`scene: None`) draws the last scene
//! again, and keeps a scene that waits.
//!
//! It owns the window's swapchain (`gpu::Swapchain`), and waits for an image the OS withholds or
//! hands out late; the main thread reads when to ask again (`State`). Headless it renders each frame
//! off screen while a frame trace runs, so the gate's frames cost the GPU what shown ones do. It
//! locks the compositor's state (`composed::Shared`) only to render, as an import does; the
//! textures a laid-out scene draws keep their sizes while it waits (`composed_retired.rs`).

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use desk_compositor::Scene;
use desk_compositor::headless::Target as Offscreen;

use super::clock::Behind;
use super::composed::Shared;
use super::gpu::{PAUSED, Swapchain};
use crate::frame_trace::{self, Timed};

/// An image asked of the window this late held the render thread for it.
const SLOW_IMAGE: Duration = Duration::from_millis(250);
/// So many late images in a row and the window presents nothing for a while (`gpu::PAUSED`).
const SLOW_IMAGES: u32 = 3;
/// The most frames waiting: the one due, and the next slot's.
const WAITING: usize = 2;

/// A frame the main thread laid out, for the render thread to draw.
pub struct Handed {
    /// Its scene, or `None`: the last one again, only pictures changed.
    pub scene: Option<Scene>,
    /// The beat it was laid out on (`Due::beat`).
    pub slot: Instant,
    /// Its parts' times for the frame trace: the layout's, then the image's and the render's here.
    pub timed: Timed,
    /// The window's count of frames composed.
    pub n: u64,
}

/// Where the render thread draws.
pub enum Target {
    /// The window's swapchain.
    Window(Swapchain),
    /// Nowhere (`DESK_COMPOSITOR_HEADLESS`): off screen when `render` (a frame trace runs).
    Unseen { render: bool },
}

/// What the render thread did, for the window's next wake-up and the checks.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// Frames drawn, and those presented to the window.
    pub drawn: u64,
    pub presented: u64,
    /// The last frame drawn, and when.
    pub last: Option<(u64, Instant)>,
    /// When to ask again for a frame the OS withheld, or after images came late (`PAUSED`).
    pub withheld: Option<Instant>,
    /// Late images in a row, and whether frames go to the window.
    pub slow: u32,
    pub presenting: bool,
}

/// What the main thread and the render thread share.
struct Mail {
    pending: VecDeque<Handed>,
    every: Duration,
    /// The window shows again, or a frame the OS withheld is due to be asked for again.
    resume: bool,
    stop: bool,
    state: State,
}

type Shared2 = (Mutex<Mail>, Condvar);

fn lock(mail: &Mutex<Mail>) -> MutexGuard<'_, Mail> {
    mail.lock().unwrap_or_else(|e| e.into_inner())
}

/// The render thread, and what it shares with the main thread.
pub struct RenderThread {
    mail: Arc<Shared2>,
    /// It hands its target back when it stops: the swapchain holds the window, which goes on the
    /// main thread (winit's window waits for the main thread as it goes, which waits in `join`).
    thread: Option<JoinHandle<Target>>,
}

impl RenderThread {
    /// Start the thread drawing to `target` with `shared`'s compositor, the display's frames
    /// `every` apart.
    pub fn start(target: Target, shared: Shared, every: Duration) -> RenderThread {
        let state = State {
            presenting: matches!(target, Target::Window(_)),
            ..State::default()
        };
        let mail = Arc::new((
            Mutex::new(Mail {
                pending: VecDeque::new(),
                every,
                resume: false,
                stop: false,
                state,
            }),
            Condvar::new(),
        ));
        let theirs = Arc::clone(&mail);
        let spawned = std::thread::Builder::new()
            .name("desk-render".to_owned())
            .spawn(move || {
                interactive();
                Drawer::new(target, shared).run(&theirs)
            });
        let thread = spawned
            .map_err(|why| eprintln!("endue Desk: no render thread ({why}): nothing is drawn"))
            .ok();
        RenderThread { mail, thread }
    }

    fn lock(&self) -> MutexGuard<'_, Mail> {
        lock(&self.mail.0)
    }

    /// A frame to draw: it replaces the one waiting for its slot, or waits behind it; a frame of
    /// the pictures alone keeps a scene still waiting (drawn now, it shows the newest pictures too).
    pub fn hand(&self, handed: Handed) {
        let mut mail = self.lock();
        let waits = mail.pending.iter().any(|p| p.scene.is_some());
        if handed.scene.is_none() && waits {
            return;
        }
        if mail.pending.back().is_some_and(|p| p.slot == handed.slot) {
            mail.pending.pop_back();
        }
        mail.pending.push_back(handed);
        while mail.pending.len() > WAITING {
            mail.pending.pop_front();
        }
        self.mail.1.notify_all();
    }

    /// The window's display shows a frame every `every`.
    pub fn set_interval(&self, every: Duration) {
        self.lock().every = every;
    }

    /// The window shows again, or a withheld frame is due to be asked for: the next frame tries.
    pub fn resume(&self) {
        let mut mail = self.lock();
        mail.resume = true;
        mail.state.withheld = None;
    }

    /// What it did so far.
    pub fn state(&self) -> State {
        self.lock().state
    }
}

impl Drop for RenderThread {
    fn drop(&mut self) {
        self.lock().stop = true;
        self.mail.1.notify_all();
        if let Some(thread) = self.thread.take() {
            // Its target, the window's swapchain, goes here.
            drop(thread.join());
        }
    }
}

/// The render thread's own: where it draws, the last scene, and its pace.
struct Drawer {
    target: Target,
    shared: Shared,
    device: wgpu::Device,
    queue: wgpu::Queue,
    scene: Option<Scene>,
    offscreen: Option<Offscreen>,
    behind: Behind,
    slow: u32,
}

impl Drawer {
    fn new(target: Target, shared: Shared) -> Drawer {
        let (device, queue) = {
            let composed = shared.lock();
            let c = &composed.compositor;
            (c.device().clone(), c.queue().clone())
        };
        Drawer {
            target,
            shared,
            device,
            queue,
            scene: None,
            offscreen: None,
            behind: Behind::default(),
            slow: 0,
        }
    }

    /// Draw each frame at its time until the thread stops; its target, to go where it was made.
    fn run(mut self, mail: &Shared2) -> Target {
        while let Some((handed, resume)) = self.next(mail) {
            if let (true, Target::Window(chain)) = (resume, &mut self.target) {
                chain.resume();
            }
            let n = handed.n;
            let presented = self.draw(handed);
            let mut mail = lock(&mail.0);
            let state = &mut mail.state;
            state.drawn += 1;
            state.presented += u64::from(presented);
            state.last = Some((n, Instant::now()));
            state.slow = self.slow;
            if let Target::Window(chain) = &self.target {
                state.withheld = chain.withheld();
                state.presenting = chain.presents();
            }
        }
        self.target
    }

    /// The next frame, at its time, and whether to try the window again; `None` once it stops.
    fn next(&mut self, mail: &Shared2) -> Option<(Handed, bool)> {
        let (lock_, wake) = mail;
        let mut m = lock(lock_);
        loop {
            if m.stop {
                return None;
            }
            let Some(slot) = m.pending.front().map(|p| p.slot) else {
                m = wake.wait(m).unwrap_or_else(|e| e.into_inner());
                continue;
            };
            let at = self.behind.draw_at(slot, Instant::now(), m.every);
            while let Some(wait) = at.checked_duration_since(Instant::now()) {
                if m.stop || wait.is_zero() {
                    break;
                }
                m = wake
                    .wait_timeout(m, wait)
                    .unwrap_or_else(|e| e.into_inner())
                    .0;
            }
            if m.stop {
                return None;
            }
            if let Some(handed) = m.pending.pop_front() {
                return Some((handed, std::mem::take(&mut m.resume)));
            }
        }
    }

    /// Draw `handed`; whether it was presented to the window.
    fn draw(&mut self, handed: Handed) -> bool {
        let Handed {
            scene, timed, n, ..
        } = handed;
        if scene.is_some() {
            self.scene = scene;
        }
        let Some(scene) = self.scene.take() else {
            return false;
        };
        let presented = match &mut self.target {
            Target::Window(chain) if chain.presents() => {
                let (shown, slow) = present(&self.shared, &self.queue, chain, &scene, timed, n);
                self.slow = if slow { self.slow + 1 } else { 0 };
                if self.slow >= SLOW_IMAGES {
                    // A locked screen, a display going off: the images come late, each holding this
                    // thread. The frame in hand went out first; its surface stays (`gpu.rs`).
                    eprintln!(
                        "endue Desk: the window cannot present; composing off screen only for {PAUSED:?}"
                    );
                    chain.stop_presenting(Instant::now());
                }
                shown
            }
            Target::Window(_) => {
                let render = frame_trace::on();
                self.unseen(&scene, timed, n, render);
                false
            }
            Target::Unseen { render } => {
                let render = *render;
                self.unseen(&scene, timed, n, render);
                false
            }
        };
        self.scene = Some(scene);
        presented
    }

    /// A frame not presented: rendered off screen when `render`, after the last one finished (one
    /// frame in flight, as a swapchain keeps a frame or two).
    fn unseen(&mut self, scene: &Scene, mut timed: Timed, n: u64, render: bool) {
        if !render {
            self.shared.lock().retire_drawn(n);
            return;
        }
        timed.mark();
        let size = scene.viewport();
        let _ = self.device.poll(wgpu::PollType::wait_indefinitely());
        let mut composed = self.shared.lock();
        if self.offscreen.as_ref().is_none_or(|t| t.size != size) {
            let format = composed.compositor.format();
            self.offscreen = Some(Offscreen::new(&self.device, size, format));
        }
        if let Some(target) = self.offscreen.as_ref() {
            composed.compositor.invalidate();
            composed.compositor.render(scene, &target.view, size);
        }
        composed.retire_drawn(n);
        drop(composed);
        timed.end(n, false);
    }
}

/// `scene` to the window's next image; whether it was shown, and whether the image came late.
fn present(
    shared: &Shared,
    queue: &wgpu::Queue,
    chain: &mut Swapchain,
    scene: &Scene,
    mut timed: Timed,
    n: u64,
) -> (bool, bool) {
    chain.fit(scene.viewport());
    let started = Instant::now();
    let frame = chain.frame();
    timed.mark();
    let slow = started.elapsed() > SLOW_IMAGE;
    let shown = frame.is_some();
    let mut composed = shared.lock();
    if let Some(frame) = frame {
        let view = frame
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let size = (frame.texture.width(), frame.texture.height());
        composed.compositor.invalidate();
        composed.compositor.render(scene, &view, size);
        composed.retire_drawn(n);
        drop(composed);
        queue.present(frame);
    } else {
        composed.retire_drawn(n);
        drop(composed);
    }
    timed.end(n, shown);
    (shown, slow)
}

/// The render thread runs at the main thread's priority: a frame waits for no build.
#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
fn interactive() {
    // SAFETY: sets the calling thread's own quality of service; nothing is passed by pointer.
    unsafe {
        libc::pthread_set_qos_class_self_np(libc::qos_class_t::QOS_CLASS_USER_INTERACTIVE, 0);
    }
}

#[cfg(not(target_os = "macos"))]
fn interactive() {}

#[cfg(test)]
#[path = "render_thread_tests.rs"]
mod tests;
