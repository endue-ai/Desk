//! Launch bookkeeping for safe mode: a launch that never reaches ready counts against the next one,
//! and a desk that failed to start twice in a row starts in safe mode.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Launches in a row that never reached ready before the next one starts in safe mode.
pub const UNREADY_LIMIT: u32 = 2;

/// Why this launch runs in safe mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SafeReason {
    /// `--safe-mode` or `DESK_SAFE_MODE=1`.
    Asked,
    /// The person chose "Restart in safe mode" last time.
    Restarted,
    /// The last launches never reached ready.
    FailedLaunches(u32),
}

impl SafeReason {
    /// The status line's words for it.
    pub fn describe(self) -> String {
        match self {
            Self::Asked => "safe mode".to_owned(),
            Self::Restarted => "safe mode (restarted in safe mode)".to_owned(),
            Self::FailedLaunches(n) => format!("safe mode (the last {n} launches did not finish)"),
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    #[serde(default)]
    unready: u32,
    #[serde(default)]
    safe_next: bool,
}

/// The launch record in the app's data folder (`launch.json`).
#[derive(Debug, Clone)]
pub struct LaunchGuard {
    path: PathBuf,
}

impl LaunchGuard {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    /// Record a launch and decide whether it runs in safe mode. `asked` is the person asking for it
    /// at launch (flag or environment).
    pub fn begin(&self, asked: bool) -> Option<SafeReason> {
        let mut state = self.load();
        let reason = if asked {
            Some(SafeReason::Asked)
        } else if state.safe_next {
            Some(SafeReason::Restarted)
        } else if state.unready >= UNREADY_LIMIT {
            Some(SafeReason::FailedLaunches(state.unready))
        } else {
            None
        };
        state.unready += 1;
        state.safe_next = false;
        self.save(&state);
        reason
    }

    /// The desk reached ready: this launch counts as finished.
    pub fn ready(&self) {
        let mut state = self.load();
        state.unready = 0;
        self.save(&state);
    }

    /// Start the next launch in safe mode.
    pub fn safe_next(&self) {
        let mut state = self.load();
        state.safe_next = true;
        self.save(&state);
    }

    fn load(&self) -> State {
        fs::read_to_string(&self.path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    fn save(&self, state: &State) {
        if let Some(parent) = self.path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string(state) {
            let _ = fs::write(&self.path, text);
        }
    }
}
