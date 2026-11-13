//! Windows out of the canvas (#235, ADR 0205): the window manager's plan lists them apart from
//! the windows the compositor draws, and the compositor hands their surfaces to the web host,
//! which shows them in OS windows of their own (`web_host/app_surfaces.rs`). The plugins
//! `DESK_APP_WINDOWS` names pop out the first time their window shows in a session. The shell
//! runs the window commands an OS window calls for (its frame, its dock) through here.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use desk_wm::Rect;
use desk_wm::interact::Op;

use super::CompositorWindow;
use crate::web_host::OutAsk;

/// The windows popped out by the switch this session: each pops out once, so one the person
/// docked stays on the canvas.
fn defaulted() -> &'static Mutex<HashSet<String>> {
    static ONCE: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    ONCE.get_or_init(Mutex::default)
}

impl CompositorWindow {
    /// Hand the windows out of the canvas to the web host, by surface host, and pop out the
    /// windows of the plugins the switch names, once a session.
    pub(super) fn hand_out(&mut self) {
        let Some(plan) = self.hosted.plan() else {
            return;
        };
        let mut out = BTreeMap::new();
        for w in &plan.out {
            for plugin in &w.plugins {
                if let Some(frame) = self.hosted.frame(plugin) {
                    let ask = OutAsk {
                        window: w.id.clone(),
                        plugin: plugin.clone(),
                        title: w.title.clone(),
                    };
                    out.insert(frame.host.clone(), ask);
                }
            }
        }
        let switch = crate::app_windows::switch();
        let pops: Vec<String> = if switch.is_on() {
            let mut done = defaulted().lock().unwrap_or_else(|e| e.into_inner());
            (plan.windows.iter())
                .filter(|w| w.panes.len() == 1)
                .filter(|w| (w.panes[0].plugin.as_deref()).is_some_and(crate::app_windows::handed))
                .filter(|w| done.insert(w.id.clone()))
                .map(|w| w.id.clone())
                .collect()
        } else {
            Vec::new()
        };
        self.host.set_out(out);
        for window in pops {
            self.run_window_op(&Op::PopOut { frame: None }, &window);
        }
    }

    /// Run window command `op` on window `window`, as the shell asks for an OS window.
    pub fn run_window_op(&mut self, op: &Op, window: &str) {
        let outs = self.hosted.wm.run(op, Some(window));
        self.wm_outs(outs, Instant::now());
    }

    /// The OS frame window `window` has while it is out, as the window manager keeps it.
    pub fn out_frame(&self, window: &str) -> Option<Rect> {
        self.hosted.wm.desk().out_window(window)?.1.out
    }
}
