//! What Studio's board reads beyond agent-service's Studio facets (ADR 0232): an agent's channel
//! pairings, endue OS devices, workspaces and theme (agent-service), its memories (ai-agent-service),
//! the person's API keys (user-service) and how many artifacts it made (artifact-service).

use desk_sys::net::Method;

use crate::Platform;
use crate::agents::agent_path;
use crate::error::{ErrorKind, PlatformError, Result};
use crate::http::{encode, with_query};
use crate::wire_board::{
    ApiKey, ApiKeyList, ArtifactListEnvelope, ChannelPairing, ChannelPairingList, MemoryList,
    OsDevice, OsDeviceList, Outputs, ThemeState, Workspace, WorkspaceList,
};

/// Memories counted for the board, the newest first, as endue.ai's board counts them.
pub const MEMORIES: u64 = 200;

impl Platform {
    pub fn channel_pairings(&self, id: &str) -> Result<Vec<ChannelPairing>> {
        let path = format!("{}/channel-pairings", agent_path(id));
        let list: ChannelPairingList = self.read(Method::Get, &path, None, "channel pairings")?;
        Ok(list.pairings)
    }

    /// The person's endue OS devices attached to the agent.
    pub fn os_devices(&self, id: &str) -> Result<Vec<OsDevice>> {
        let path = format!("{}/os-devices", agent_path(id));
        let list: OsDeviceList = self.read(Method::Get, &path, None, "devices")?;
        Ok(list.devices)
    }

    /// The agent's workspaces; none while endue AI has workspaces turned off (404
    /// FEATURE_DISABLED).
    pub fn workspaces(&self, id: &str) -> Result<Vec<Workspace>> {
        let path = format!("{}/workspaces", agent_path(id));
        match self.read::<WorkspaceList>(Method::Get, &path, None, "workspaces") {
            Ok(list) => Ok(list.workspaces),
            Err(e) if e.kind == ErrorKind::NotFound && e.code.as_deref() == Some(OFF) => {
                Ok(Vec::new())
            }
            Err(e) => Err(e),
        }
    }

    pub fn theme(&self, id: &str) -> Result<ThemeState> {
        let path = format!("{}/theme", agent_path(id));
        self.read(Method::Get, &path, None, "theme")
    }

    /// The newest `limit` memories, for counting.
    pub fn memories(&self, id: &str, limit: u64) -> Result<MemoryList> {
        let base = format!("/api/v1/ai/agents/{}/memories", encode(id));
        let path = with_query(&base, &[("limit", Some(limit.to_string()))]);
        self.read(Method::Get, &path, None, "memories")
    }

    /// Every API key of the person's: for one agent, and for all of them.
    pub fn api_keys(&self) -> Result<Vec<ApiKey>> {
        let list: ApiKeyList = self.read(Method::Get, "/api/v1/me/api-keys", None, "API keys")?;
        Ok(list.items)
    }

    /// How many artifacts agent `id` made, and when the newest changed: one row is asked for, and
    /// the count is the page's total. A page without a total is not the contract's.
    pub fn outputs(&self, id: &str) -> Result<Outputs> {
        let query = [
            ("agent_id", Some(id.to_owned())),
            ("limit", Some("1".to_owned())),
        ];
        let path = with_query("/api/v1/artifacts", &query);
        let page: ArtifactListEnvelope = self.read_whole(Method::Get, &path, "artifacts")?;
        let total = page.meta.and_then(|m| m.pagination).and_then(|p| p.total);
        let Some(total) = total else {
            let why = "endue AI answered artifacts without their total";
            return Err(PlatformError::new(ErrorKind::Failed, why));
        };
        let latest_at = page.data.into_iter().next().and_then(|a| a.updated_at);
        Ok(Outputs { total, latest_at })
    }
}

/// The code endue AI answers every workspace path with while workspaces are off.
const OFF: &str = "FEATURE_DISABLED";
