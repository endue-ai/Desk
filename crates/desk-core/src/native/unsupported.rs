//! A native plugin's process where the desk has no transport for it yet (Windows, until #61 gives
//! it named pipes): starting one fails, so its surface reports `launch-failed`.

use std::io;
use std::sync::Arc;

use super::{Ended, NativeLaunch};
use crate::handler::Core;

/// Why a native plugin cannot start on this platform.
pub const UNSUPPORTED: &str =
    "native plugins need the desk's Unix socket pair, which Windows does not have yet (#61)";

/// A running native plugin: never on this platform.
pub struct NativeProcess {
    pid: u32,
}

impl NativeProcess {
    pub fn start(
        _core: &Arc<Core>,
        _launch: &NativeLaunch,
        _extra: &[(String, String)],
        _ended: impl FnOnce(Ended) + Send + 'static,
    ) -> io::Result<NativeProcess> {
        Err(io::Error::new(io::ErrorKind::Unsupported, UNSUPPORTED))
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn has_ended(&self) -> bool {
        true
    }

    pub fn stop(&self) {}

    pub fn kill(&self) {}
}
