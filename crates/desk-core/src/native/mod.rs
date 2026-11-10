//! Native plugins (#59, ADR 0154): kind `native` is a program per OS that the desk runs as a process
//! of its own. The core decides whether a plugin may start and what starting it runs (`launch.rs`),
//! starts the process with its two connections and watches it end (`process.rs`), and serves its
//! bridge connection on the wire of `desk.sock` with the plugin as the caller, whatever the process
//! sends (`bridge.rs`), each event for it alone (`events.rs`). The surface connection is the
//! shell's: it speaks `specs/surface` with the compositor.

mod events;
mod launch;

#[cfg(unix)]
mod bridge;
#[cfg(unix)]
mod process;
#[cfg(not(unix))]
#[path = "unsupported.rs"]
mod process;

pub use launch::{DEFAULT_GRACE, NativeLaunch, platform, program_for};
pub use process::NativeProcess;

pub(crate) use launch::problems;

/// How a native plugin's process ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exit {
    /// It exited with this code.
    Code(i32),
    /// A signal ended it (Unix): 9 is `SIGKILL`.
    Signal(i32),
}

/// A native plugin's process ended: how, and whether the desk had asked it to stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ended {
    pub exit: Exit,
    /// The desk asked it to stop (`stop`, `kill`): the end is no death.
    pub asked: bool,
}
