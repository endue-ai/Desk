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

impl CompositorWindow {
    /// Do what a look called for: the surfaces' steps, the live set and the window manager's
    /// changes for the runtime.
    pub(super) fn carry(&mut self, mut outcome: Outcome) {
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
                }
                // Its process goes: its imports with it, its last frame (a copy) stays.
                Step::Sleep { surface } => {
                    let mut composed = self.shared.lock();
                    if let Some(id) = composed.texture_of(surface) {
                        composed.frames.ended(id);
                    }
                    drop(composed);
                    self.forget(surface);
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
        // The next frame shows it, and the accessibility tree follows the surfaces (#155).
        self.shared.lock().dirty = true;
        self.a11y.changed();
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
