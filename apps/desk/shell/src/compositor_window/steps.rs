//! What a look at the hosted desk calls for, carried out (#81, #80): the surfaces' lifecycle steps
//! to the web host or the native host (#59), the live set to the runtime (`desk://compositor-live`),
//! the window manager's changes to the runtime and the page (`wm.rs`), and a surface that goes
//! forgotten by the input router.

use desk_surface::generated::CompositorMessage;
use desk_web::sender::Role;
use desk_wm::Step;
use serde_json::json;

use super::hosted::{Outcome, message};
use super::{CompositorWindow, LIVE};
use crate::web_host::window_pages::{self, Placed};

impl CompositorWindow {
    /// Do what a look called for: the surfaces' steps, the live set and the window manager's
    /// changes for the runtime.
    pub(super) fn carry(&mut self, mut outcome: Outcome) {
        // A window that pops out leaves its off-screen browser before the steps reach it (#235).
        self.hand_out();
        self.emit_wm(std::mem::take(&mut outcome.wm));
        for step in &outcome.steps {
            if let Step::Load { surface, url } = step {
                if !self.native.load(surface) {
                    self.host.load(surface, url);
                }
                continue;
            }
            let Some(message) = message(step) else {
                continue;
            };
            match step {
                Step::Destroy { surface } => {
                    self.shared.lock().destroy(surface);
                    self.forget(surface);
                    // Its web view goes with it (ADR 0216).
                    self.host.web_end(surface);
                }
                // Its process goes: its imports with it, its last frame (a copy) stays.
                Step::Sleep { surface } => {
                    let mut composed = self.shared.lock();
                    if let Some(id) = composed.texture_of(surface) {
                        composed.frames.ended(id);
                    }
                    drop(composed);
                    self.forget(surface);
                    self.host.web_end(surface);
                }
                _ => {}
            }
            self.send_to(&message);
        }
        if let Some(live) = outcome.live {
            self.desk
                .pages
                .emit(Role::Main, LIVE, json!({ "live": live }));
        }
        self.place_window_pages();
        self.web_swept();
        // The next frame shows it, and the accessibility tree follows the surfaces (#155).
        self.shared.lock().dirty = true;
        self.a11y.changed();
    }

    /// Every window's own page at its window's size, hidden while its window is not drawn (ADR
    /// 0201): a move changes nothing it lays out, so it paints nothing for one. A page replaced
    /// (`popup_room.rs`) leaves its last picture drawn until the next one paints over it, the
    /// pointer meanwhile to the desk's page, which holds the window again (`register`); the
    /// texture of a window gone goes with it, so a window opened again under its id never shows
    /// the last one's picture.
    pub(super) fn place_window_pages(&mut self) {
        let live: std::collections::BTreeSet<String> =
            (self.host.surfaces().into_iter())
                .filter(|s| window_pages::is_window_page(s))
                .chain(self.hosted.plan().into_iter().flat_map(|plan| {
                    (plan.windows.iter()).map(|w| window_pages::surface_of(&w.id))
                }))
                .collect();
        let gone: Vec<String> = (self.shared.lock().surfaces())
            .filter(|s| window_pages::is_window_page(s) && !live.contains(*s))
            .map(str::to_owned)
            .collect();
        if !gone.is_empty() {
            let mut composed = self.shared.lock();
            for surface in &gone {
                composed.destroy(surface);
            }
            composed.dirty = true;
            drop(composed);
            for surface in &gone {
                self.forget(surface);
            }
        }
        let scale = self.window.scale_factor() as f32;
        let px = |v: f64| v.round().max(1.0) as u32;
        let placed: Vec<Placed> = self.hosted.plan().map_or_else(Vec::new, |plan| {
            plan.windows
                .iter()
                .map(|w| Placed {
                    surface: window_pages::surface_of(&w.id),
                    size: (px(w.rect.w), px(w.rect.h)),
                    scale,
                    hidden: false,
                })
                .collect()
        });
        self.host.place_window_pages(&placed);
    }

    /// A message to the surface it is about: a native plugin's process, or a web surface's browser.
    pub(super) fn send_to(&self, message: &CompositorMessage) {
        if !self.native.send(message) {
            self.host.send(message);
        }
    }

    /// Surface `surface` takes no input any more (destroyed, asleep, died).
    pub(super) fn forget(&mut self, surface: &str) {
        let _ = self.router.forget(surface);
        self.router.targets.forget(surface);
        if self.tips.forget(surface) {
            self.shared.lock().dirty = true;
        }
    }
}
