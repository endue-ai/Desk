//! `desk cmd run`: invoke a command and print its answer. With `--timeout`, the CLI stops waiting
//! once that many seconds pass and exits 1, so a command nobody answers cannot hang a script (#1).
//! A command that starts the desk again never answers: when the desk closes the connection while
//! it runs and a desk answers at the socket again, that is said and the exit is 0 (`gone`).

use std::process::ExitCode;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{Map, Value};

use super::{Problem, Session, gone, say};

impl Session {
    pub(super) fn cmd_run(
        &mut self,
        id: &str,
        args: Option<Map<String, Value>>,
        timeout: Option<u64>,
    ) -> Result<ExitCode, Problem> {
        let watch = timeout.map(|seconds| Watch::start(id, seconds, self.json));
        let reply = self.invoke_and_wait(id, args);
        let restarted = matches!(reply, Err(Problem::Closed(_))) && gone::came_back(&self.path);
        if let Some(watch) = watch {
            watch.stop();
        }
        if restarted {
            eprintln!(
                "desk: the desk closed the connection while {id} ran and started again; it answers at {}",
                self.path.display()
            );
            return Ok(ExitCode::SUCCESS);
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
    fn start(id: &str, seconds: u64, json: bool) -> Self {
        let stopped = Arc::new(Mutex::new(false));
        let watching = Arc::clone(&stopped);
        let message = format!("no answer to {id} within {seconds} s");
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs(seconds));
            // Held while it exits: an answer that comes now waits instead of printing half.
            let stopped = watching.lock().unwrap_or_else(PoisonError::into_inner);
            if !*stopped {
                say(json, "timeout", &message);
                std::process::exit(1);
            }
        });
        Self(stopped)
    }

    fn stop(self) {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner) = true;
    }
}
