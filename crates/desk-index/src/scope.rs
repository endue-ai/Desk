//! The caller's `data:read` scope, and the connector id matcher it uses inside SQL.

use desk_bridge::{ConnectorPattern, DataReadPermission, ItemKind};

/// What a caller may read: the kinds and connector id patterns of its `data:read` scope. `None`
/// means all of them; an empty list covers nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct DataReadScope {
    pub kinds: Option<Vec<ItemKind>>,
    pub sources: Option<Vec<ConnectorPattern>>,
}

impl DataReadScope {
    /// Every kind from every connector: the core's own reads.
    pub fn all() -> Self {
        Self::default()
    }
}

impl From<&DataReadPermission> for DataReadScope {
    fn from(perm: &DataReadPermission) -> Self {
        Self {
            kinds: perm.kinds.clone(),
            sources: perm.sources.clone(),
        }
    }
}

impl From<DataReadPermission> for DataReadScope {
    fn from(perm: DataReadPermission) -> Self {
        Self {
            kinds: perm.kinds,
            sources: perm.sources,
        }
    }
}
