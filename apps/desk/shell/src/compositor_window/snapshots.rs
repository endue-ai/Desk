//! Snapshots of surfaces for the core (#54, ADR 0161): `ui.surface.snapshot` asks the compositor
//! that holds each surface's frame. The core calls on a bridge thread of its own; the frame is read
//! back on the event loop's thread, where the compositor is, and the answer waits for it. A surface
//! is named by its plugin and the manifest's surface id, which make its host; a sleeping one gives
//! its last frame, which the compositor keeps (`steps.rs`).

use std::sync::mpsc;
use std::time::Duration;

use desk_compositor::read_texture;
use desk_core::{ShotError, SurfaceShot, SurfaceSnapshots};

use super::CompositorWindow;
use super::hosted::owner;
use crate::pump::Pump;

/// How long a snapshot waits for the event loop.
const WAIT: Duration = Duration::from_secs(10);

/// What the core takes snapshots through while the compositor window is open.
pub struct Snapshots {
    pump: Pump,
}

impl Snapshots {
    pub fn new(pump: Pump) -> Snapshots {
        Snapshots { pump }
    }
}

impl SurfaceSnapshots for Snapshots {
    fn snapshot(
        &self,
        plugin: &str,
        surface: &str,
        max: (Option<u32>, Option<u32>),
    ) -> Result<SurfaceShot, ShotError> {
        let (sent, answered) = mpsc::channel();
        let (plugin, surface) = (plugin.to_owned(), surface.to_owned());
        self.pump.run(move |shell, _| {
            let answer = match shell.compositor.as_mut() {
                Some(c) => c.snapshot(&plugin, &surface, max),
                None => Err(ShotError::Failed(
                    "the desk has no compositor window".into(),
                )),
            };
            let _ = sent.send(answer);
        });
        answered
            .recv_timeout(WAIT)
            .map_err(|_| ShotError::Failed("the compositor did not answer".into()))?
    }
}

impl CompositorWindow {
    /// Plugin `plugin`'s surface `surface` as a PNG, at most `max` pixels on each side given.
    pub fn snapshot(
        &mut self,
        plugin: &str,
        surface: &str,
        max: (Option<u32>, Option<u32>),
    ) -> Result<SurfaceShot, ShotError> {
        let made = self.hosted.surfaces().made();
        let named = |host: &str| owner(host).is_some_and(|(p, s)| p == plugin && s == surface);
        let Some((host, _, asleep)) = made.into_iter().find(|(host, ..)| named(host)) else {
            return Err(ShotError::NotFound(format!(
                "{plugin} shows no surface {surface} on the desk"
            )));
        };
        let mut composed = self.shared.lock();
        let found =
            (composed.texture_of(&host)).and_then(|id| Some((id, composed.frames.size(id)?)));
        let Some((id, size)) = found else {
            return Err(ShotError::NotFound(format!(
                "{plugin}'s surface {surface} has shown no frame yet"
            )));
        };
        let read = read_texture(&mut composed.compositor, id, size, max);
        drop(composed);
        let ((width, height), rgba) = read.map_err(|e| ShotError::Failed(e.to_string()))?;
        let png = encode(width, height, &rgba).map_err(ShotError::Failed)?;
        let scale = self.window.scale_factor() * f64::from(width) / f64::from(size.0.max(1));
        Ok(SurfaceShot {
            png,
            width,
            height,
            scale,
            asleep,
        })
    }
}

/// RGBA rows as a PNG.
fn encode(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(png)
}
