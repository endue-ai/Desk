//! How the core talks to a brain: the session store, the lease and the retries (conversation.rs).

use std::path::PathBuf;
use std::time::Duration;

/// Which kind of brain the desk talks to, as brain.status reports it while the brain answers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum BrainMode {
    /// A brain over the network, such as endue AI or examples/brain-echo.
    #[default]
    Cloud,
    /// A brain on this machine, running `model`.
    Local { model: String },
}

/// How the core talks to its brain.
#[derive(Debug, Clone)]
pub struct BrainOptions {
    /// The session store file; `None` keeps it in memory.
    pub state_file: Option<PathBuf>,
    /// The name other desks see in lease conflicts. `None` shows only the random desk id.
    pub desk_name: Option<String>,
    pub ttl_seconds: u64,
    /// The first wait before retrying an unreachable brain. It doubles up to `max_retry`.
    pub retry: Duration,
    pub max_retry: Duration,
    /// What brain.status names while the brain answers.
    pub mode: BrainMode,
}

impl Default for BrainOptions {
    fn default() -> Self {
        Self {
            state_file: None,
            desk_name: None,
            ttl_seconds: 60,
            retry: Duration::from_secs(1),
            max_retry: Duration::from_secs(15),
            mode: BrainMode::Cloud,
        }
    }
}
