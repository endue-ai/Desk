//! `desk cmd run`: invoke a command and print its answer. With `--timeout`, the CLI stops waiting
//! once that many seconds pass and exits 1, so a command nobody answers cannot hang a script (#1).

use std::process::ExitCode;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{Map, Value};

use super::{Problem, Session};

impl Session {
    pub(super) fn cmd_run(
        &mut self,
        id: &str,
        args: Option<Map<String, Value>>,
        timeout: Option<u64>,
    ) -> Result<ExitCode, Problem> {
        let watch = timeout.map(|seconds| Watch::start(id, seconds));
        let reply = self.invoke_and_wait(id, args);
        if let Some(watch) = watch {
            watch.stop();
        }
        Ok(self.report(reply?, |result| match result {
            Value::Null => Vec::new(),
            value => vec![value.to_string()],
        }))
    }
}

/// Ends the CLI with exit 1 when its time passes, unless stopped first because the answer came.
struct Watch(Arc<Mutex<bool>>);

impl Watch {
    fn start(id: &str, seconds: u64) -> Self {
        let stopped = Arc::new(Mutex::new(false));
        let watching = Arc::clone(&stopped);
        let message = format!("desk: no answer to {id} within {seconds} s");
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(seconds));
            // Held while it exits: an answer that comes now waits instead of printing half.
            let stopped = watching.lock().unwrap_or_else(PoisonError::into_inner);
            if !*stopped {
                eprintln!("{message}");
                std::process::exit(1);
            }
        });
        Self(stopped)
    }

    fn stop(self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
    }
}
