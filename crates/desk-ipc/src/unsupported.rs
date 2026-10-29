//! No socket on this platform yet (Windows: a named pipe with an owner check is a later task, ADR
//! 0030). The types exist so callers compile; `bind` and `connect` answer `Unsupported`.

use std::convert::Infallible;
use std::io;
use std::path::Path;
use std::sync::Arc;

use desk_bridge::{BridgeEvent, BridgeRequest, BridgeResponse};
use desk_core::Core;

use crate::UNSUPPORTED;

fn unsupported() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, UNSUPPORTED)
}

/// Never constructed on this platform.
pub struct Listener {
    never: Infallible,
}

impl Listener {
    pub fn bind(_path: &Path, _core: Arc<Core>) -> io::Result<Self> {
        Err(unsupported())
    }

    pub fn path(&self) -> &Path {
        match self.never {}
    }
}

/// Never constructed on this platform.
pub struct Client {
    never: Infallible,
}

impl Client {
    pub fn connect(_path: &Path) -> io::Result<Self> {
        Err(unsupported())
    }

    pub fn call(&mut self, _request: BridgeRequest) -> io::Result<BridgeResponse> {
        match self.never {}
    }

    pub fn call_line(&mut self, _request: BridgeRequest) -> io::Result<(BridgeResponse, String)> {
        match self.never {}
    }

    pub fn next_event(&mut self) -> io::Result<BridgeEvent> {
        match self.never {}
    }

    pub fn next_event_line(&mut self) -> io::Result<(BridgeEvent, String)> {
        match self.never {}
    }
}
