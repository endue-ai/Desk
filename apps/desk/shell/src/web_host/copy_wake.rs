//! The GPU woken at input to a cold desk (#133). Each paint a surface hands the compositor is a GPU
//! copy: Chromium's capture copies the page's frame into a shared texture in its GPU process, and
//! the desk copies that into the compositor's own (`desk-compositor`'s attach, waited for in CEF's
//! paint callback). A desk that painted nothing for a second or more has a GPU asleep: the first
//! copy after took 3 to 12 ms to finish, against a fraction of one, and the desk's process waited
//! 2.5 to 4 ms more for its own than for a later one. Input to a desk that painted nothing for
//! `frames::COLD` has this thread copy a few pixels between two textures of its own on the
//! compositor's device, not waited for, before the input reaches its browser: the GPU wakes while
//! the page handles the press, and the desk's own copy path with it.
//!
//! One web host a process, so its state is the process's: `input::deliver` asks, `clock.rs` says
//! when a surface painted.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use super::SurfaceSink;
use super::frames::Copies;

/// The side of the textures it copies, in pixels.
const SIDE: u32 = 64;

/// When the desk last copied, and the thread's wake-up.
static WAKE: Mutex<Option<(Copies, Sender<()>)>> = Mutex::new(None);

fn wake() -> std::sync::MutexGuard<'static, Option<(Copies, Sender<()>)>> {
    WAKE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Start the thread on `sink`'s device (the web host's). Without it there are no wake-ups.
pub fn start(sink: Arc<dyn SurfaceSink>) {
    let (send, wakes) = mpsc::channel();
    let spawned = std::thread::Builder::new()
        .name("desk-copy-wake-up".to_owned())
        .spawn(move || run(&*sink, &wakes));
    match spawned {
        Ok(_) => *wake() = Some((Copies::default(), send)),
        Err(why) => eprintln!("endue Desk: no wake-ups for the GPU's copies ({why})"),
    }
}

/// A surface painted at `at`: a copy.
pub fn painted(at: Instant) {
    if let Some((copies, _)) = wake().as_mut() {
        copies.copied(at);
    }
}

/// Input is about to reach a browser: wake the GPU's copies if the desk's are cold.
pub fn input() {
    if let Some((copies, send)) = wake().as_mut()
        && copies.wake(Instant::now())
    {
        let _ = send.send(());
    }
}

/// The thread: a copy between its two textures at each wake-up, for the process's life.
fn run(sink: &dyn SurfaceSink, wakes: &Receiver<()>) {
    let (device, queue) = sink.device();
    let texture = || {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("desk-shell copy wake-up"),
            size: wgpu::Extent3d {
                width: SIDE,
                height: SIDE,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Bgra8Unorm,
            usage: wgpu::TextureUsages::COPY_SRC | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    };
    let (from, to) = (texture(), texture());
    while wakes.recv().is_ok() {
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("desk-shell copy wake-up"),
        });
        encoder.copy_texture_to_texture(from.as_image_copy(), to.as_image_copy(), from.size());
        queue.submit([encoder.finish()]);
    }
}
