//! Web views for the core (#273, ADR 0216): `web.*` asks the web host on the event loop's thread,
//! where CEF's browsers live, and waits for its answer; and what the compositor window does for
//! the views each look: it lays each view's page out at its box, shows the ones whose plugin
//! surface is drawn live and hides the rest, and lets go of the pictures of views that ended.
//! The keys stand in: where the desk gives them to a plugin surface whose view has them (a press
//! in the view, `web.focus`), they go to the view (`WebHost::web_stand_in`).

use std::collections::BTreeSet;
use std::sync::mpsc;
use std::time::Duration;

use desk_bridge::WebStep;
use desk_compositor::input::Out;
use desk_core::{WebError, WebPlace, WebViews};
use desk_surface::generated::CompositorMessage;

use super::CompositorWindow;
use crate::pump::Pump;
use crate::web_host::web_rules;

/// How long a call waits for the event loop.
const WAIT: Duration = Duration::from_secs(10);

/// What the core shows web views through while the compositor window is open.
pub struct Web {
    pump: Pump,
}

impl Web {
    pub fn new(pump: Pump) -> Web {
        Web { pump }
    }

    /// Run `job` with the compositor window on the event loop and wait for what it answers.
    fn ask(
        &self,
        job: impl FnOnce(&mut CompositorWindow) -> Result<(), WebError> + Send + 'static,
    ) -> Result<(), WebError> {
        let (sent, answered) = mpsc::channel();
        self.pump.run(move |shell, _| {
            let answer = match shell.compositor.as_mut() {
                Some(compositor) => {
                    let answer = job(compositor);
                    // The next frame lays the views out again.
                    compositor.shared.lock().dirty = true;
                    answer
                }
                None => Err(WebError::Failed("the desk has no compositor window".into())),
            };
            let _ = sent.send(answer);
        });
        answered
            .recv_timeout(WAIT)
            .map_err(|_| WebError::Failed("the compositor did not answer".into()))?
    }
}

impl WebViews for Web {
    fn open(&self, surface: &str, view: &str, url: Option<&str>) -> Result<(), WebError> {
        let (surface, view, url) = (surface.to_owned(), view.to_owned(), url.map(str::to_owned));
        self.ask(move |c| c.host.web_open(&surface, &view, url.as_deref()))
    }

    fn place(&self, view: &str, place: WebPlace) -> Result<(), WebError> {
        let view = view.to_owned();
        self.ask(move |c| c.host.web_place(&view, place))
    }

    fn load(&self, view: &str, url: &str) -> Result<(), WebError> {
        let (view, url) = (view.to_owned(), url.to_owned());
        self.ask(move |c| c.host.web_load(&view, &url))
    }

    fn go(&self, view: &str, step: WebStep) -> Result<(), WebError> {
        let view = view.to_owned();
        self.ask(move |c| c.host.web_go(&view, step))
    }

    fn focus(&self, view: &str) -> Result<(), WebError> {
        let view = view.to_owned();
        self.ask(move |c| c.host.web_focus(&view))
    }

    // Nobody waits for a close: the core forgot the view before it asked.
    fn close(&self, view: &str) {
        let view = view.to_owned();
        self.pump.run(move |shell, _| {
            if let Some(compositor) = shell.compositor.as_mut() {
                compositor.host.web_close(&view);
                compositor.web_swept();
            }
        });
    }
}

impl CompositorWindow {
    /// The pictures of web views that ended go, and the router forgets them: a view opened again
    /// in the same window never shows the last one's page.
    pub(super) fn web_swept(&mut self) {
        let open: BTreeSet<String> = self.host.web_surfaces().into_iter().collect();
        // A view's open popup (a list, a picker) is kept under its own name and goes with it.
        let popup = crate::web_host::render::popup::id("");
        let gone: Vec<String> = (self.shared.lock().surfaces())
            .filter(|s| web_rules::is_web_view(s) && !s.ends_with(&popup) && !open.contains(*s))
            .map(str::to_owned)
            .collect();
        if gone.is_empty() {
            return;
        }
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

    /// After a look that drew the plugin surfaces in `live` (by host): each view's page is laid
    /// out at its box and shown while its plugin's surface is drawn, hidden while it is not.
    pub(super) fn web_laid_out(&mut self, live: &BTreeSet<String>) {
        let scale = self.window.scale_factor() as f32;
        self.host.web_laid_out(&|host| live.contains(host), scale);
        self.web_swept();
    }

    /// A press the router sent on: in a view it gives the view the keys, on its window's plugin
    /// surface it takes them back.
    pub(super) fn web_pressed(&self, outs: &[Out]) {
        for out in outs {
            if let Out::Send(CompositorMessage::SurfacePointerDown(down)) = out {
                self.host.web_pressed(&down.surface);
            }
        }
    }
}
