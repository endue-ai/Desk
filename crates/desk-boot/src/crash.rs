//! Crash reports (#322): the panic hook from desk-crash, installed before anything else runs, and
//! what the shell's window asks for. `desk_crash` ([`Crash::record`]) writes a report for an uncaught error in
//! the window; `take_last_crash` hands the next start the newest report not shown yet. The plugins in
//! a report are the ones on, refreshed after start and on every plugin.changed. `DESK_E2E_PANIC=1`
//! panics right after the ready line, so a live check can force a report on any build.

use std::path::Path;
use std::sync::Arc;

use desk_bridge::BridgeEvent;
use desk_core::Core;
use desk_crash::{Context, Crashes, Report};
use serde_json::Value;

/// What the commands need: the context the hook reads and the folder the reports go to.
pub struct Crash {
    pub context: Arc<Context>,
    pub crashes: Crashes,
}

/// Install the panic hook for `data`; the returned state answers the window's commands.
pub fn install(version: &str, data: &Path, home: Option<&Path>) -> Crash {
    let commit = option_env!("DESK_BUILD_COMMIT");
    let context = Arc::new(Context::new(version, commit, home));
    desk_crash::install_hook(data.to_path_buf(), Arc::clone(&context));
    Crash {
        context,
        crashes: Crashes::in_data(data),
    }
}

/// The plugins that are on, as a report names them.
pub fn note_plugins(core: &Core, context: &Context) {
    let on = core
        .plugins()
        .into_iter()
        .filter(|plugin| plugin.enabled)
        .map(|plugin| plugin.id)
        .collect();
    context.set_plugins(on);
}

/// Note the plugins again on every plugin.changed, on a thread of its own, for the life of the app.
pub fn follow_plugins(core: &Arc<Core>, context: Arc<Context>) {
    let events = core.events().subscribe();
    let core = Arc::downgrade(core);
    let _ = std::thread::Builder::new()
        .name("desk-crash-plugins".to_owned())
        .spawn(move || {
            while let Ok(event) = events.recv() {
                if !matches!(event, BridgeEvent::PluginChanged(_)) {
                    continue;
                }
                let Some(core) = core.upgrade() else { return };
                note_plugins(&core, &context);
            }
        });
}

impl Crash {
    /// An uncaught error or rejection in the shell's window (`desk_crash`).
    pub fn record(&self, message: &str, stack: &str) -> bool {
        let report = Report::webview(message, stack, &self.context);
        match self.crashes.write(&report) {
            Ok(_) => true,
            Err(why) => {
                eprintln!("endue Desk: the crash report was not written ({why})");
                false
            }
        }
    }

    /// The newest report not shown yet, now marked shown (`take_last_crash`).
    pub fn take_last(&self) -> Option<Value> {
        self.crashes.take_unseen()
    }
}

/// Whether the environment asks the app to panic after its ready line (`DESK_E2E_PANIC=1` only).
pub fn forced_panic(value: Option<&str>) -> bool {
    value == Some("1")
}

#[cfg(test)]
mod tests {
    use super::forced_panic;

    #[test]
    fn forced_panic_only_with_desk_e2e_panic_1() {
        assert!(forced_panic(Some("1")));
        for other in [None, Some("0"), Some("true"), Some("yes"), Some("")] {
            assert!(!forced_panic(other), "{other:?}");
        }
    }
}
