//! The MCP servers init.yaml lists (ADR 0098), attached once the runtime first reports ready, so the
//! permissions view is there to ask the person for each server's first grant. Each server runs as
//! `mcp:<name>`; edits to `mcp.servers` apply at the next start, as `plugins.disabled` does.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use desk_core::Core;
use desk_mcp_client::{Host, configs};

pub struct McpServers {
    core: Arc<Core>,
    home: PathBuf,
    host: Mutex<Option<Host>>,
}

impl McpServers {
    pub fn new(core: &Arc<Core>, home: PathBuf) -> Self {
        Self {
            core: Arc::clone(core),
            home,
            host: Mutex::new(None),
        }
    }

    /// Attach the servers, the first time only.
    pub fn attach_once(&self) {
        let mut host = self
            .host
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if host.is_none() {
            let servers = configs(&self.core.init());
            *host = Some(Host::attach(&self.core, servers, self.home.clone()));
        }
    }
}
