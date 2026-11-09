//! The CEF application object: the Chromium switches every process starts with, and the message
//! pump schedule CEF asks for (external message pump, as cefclient's MainMessageLoopExternalPump).

use cef::*;
use std::cell::Cell;
use std::rc::Rc;
use std::time::{Duration, Instant};

/// When CEF next wants `do_message_loop_work`; shared with the main loop.
pub type PumpDue = Rc<Cell<Instant>>;

/// The longest wait between two pump calls, as cefclient's `kMaxTimerDelay`.
pub const MAX_PUMP_DELAY: Duration = Duration::from_millis(1000 / 30);

wrap_browser_process_handler! {
    pub struct SpikeBrowserProcess {
        due: PumpDue,
    }

    impl BrowserProcessHandler {
        fn on_schedule_message_pump_work(&self, delay_ms: i64) {
            let delay = Duration::from_millis(delay_ms.max(0) as u64).min(MAX_PUMP_DELAY);
            let at = Instant::now() + delay;
            if at < self.due.get() {
                self.due.set(at);
            }
        }
    }
}

wrap_app! {
    pub struct SpikeApp {
        switches: Vec<String>,
        due: PumpDue,
    }

    impl App {
        fn on_before_command_line_processing(
            &self,
            _process_type: Option<&CefStringUtf16>,
            command_line: Option<&mut CommandLine>,
        ) {
            let Some(command_line) = command_line else { return };
            command_line.append_switch(Some(&"no-startup-window".into()));
            command_line.append_switch(Some(&"noerrdialogs".into()));
            command_line.append_switch(Some(&"hide-crash-restore-bubble".into()));
            command_line.append_switch(Some(&"use-mock-keychain".into()));
            // One process per site, so every surface (its own *.localhost site) is its own renderer.
            command_line.append_switch(Some(&"site-per-process".into()));
            for switch in &self.switches {
                match switch.split_once('=') {
                    Some((name, value)) => command_line
                        .append_switch_with_value(Some(&name.into()), Some(&value.into())),
                    None => command_line.append_switch(Some(&switch.as_str().into())),
                }
            }
        }

        fn browser_process_handler(&self) -> Option<BrowserProcessHandler> {
            Some(SpikeBrowserProcess::new(self.due.clone()))
        }
    }
}
