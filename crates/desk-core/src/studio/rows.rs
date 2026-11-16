//! The rest of what Studio's board shows, in the bridge's shapes (ADR 0232): channels, the API keys
//! made for the agent, its devices and workspaces, what it remembers and made (counted), and its
//! chat's wallpaper. Only what a row shows is kept: no secret, prefix, memory or manifest.

use desk_bridge::{
    StudioApiKey, StudioChannel, StudioChannelStatus, StudioDevice, StudioDeviceKind, StudioMemory,
    StudioOutputs, StudioTheme, StudioWallpaper, StudioWallpaperSource,
};
use desk_platform::wire_board::{
    ApiKey, ChannelPairing, MemoryList, OsDevice, Outputs, ThemeState, WallpaperSource, Workspace,
};

use super::map::cut;

/// The longest id the bridge's schemas take; a longer one names nothing, so its row is left out.
const MAX_ID: usize = 128;

/// Whether `id` is one the bridge takes: not empty and at most `MAX_ID` characters.
fn fits(id: &str) -> bool {
    !id.is_empty() && id.chars().count() <= MAX_ID
}

/// A word, when it holds one.
fn word(text: Option<String>, max: usize) -> Option<String> {
    text.map(|t| cut(t.trim(), max)).filter(|t| !t.is_empty())
}

/// A channel in the bridge's shape; none when its id is not one the bridge takes. A channel with no
/// provider says `unknown` (the schema wants one).
pub(crate) fn channel(p: ChannelPairing) -> Option<StudioChannel> {
    if !fits(&p.id) {
        return None;
    }
    // A status the bridge has no word for answers nowhere, as inactive does.
    let status = match p.status.as_str() {
        "active" => StudioChannelStatus::Active,
        "pending" => StudioChannelStatus::Pending,
        "revoked" => StudioChannelStatus::Revoked,
        _ => StudioChannelStatus::Inactive,
    };
    Some(StudioChannel {
        provider: word(Some(p.provider), 32).unwrap_or_else(|| "unknown".to_owned()),
        name: word(p.display_name, 200).or_else(|| word(p.server_name, 200)),
        status,
        last_active_at: p.last_active_at.filter(|at| !at.is_empty()),
        id: p.id,
    })
}

/// The keys made for agent `id` alone; keys for every agent belong to the account, not its board.
pub(crate) fn api_keys(keys: Vec<ApiKey>, id: &str) -> Vec<StudioApiKey> {
    keys.into_iter()
        .filter(|k| k.agent_id.as_deref() == Some(id) && fits(&k.id))
        .map(|k| StudioApiKey {
            name: word(k.name, 200).unwrap_or_default(),
            expires_at: k.expires_at.filter(|at| !at.is_empty()),
            last_used_at: k.last_used_at.filter(|at| !at.is_empty()),
            created_at: k.created_at.filter(|at| !at.is_empty()),
            id: k.id,
        })
        .collect()
}

/// The person's devices attached to the agent, then its workspaces. A workspace's own device is the
/// workspace, so it is counted once, as a workspace.
pub(crate) fn devices(attached: Vec<OsDevice>, workspaces: Vec<Workspace>) -> Vec<StudioDevice> {
    let devices = attached
        .into_iter()
        .filter(|d| d.workspace_id.as_deref().is_none_or(str::is_empty) && fits(&d.device_id))
        .map(|d| StudioDevice {
            kind: match d.kind.as_str() {
                "chrome" => StudioDeviceKind::Chrome,
                "android" => StudioDeviceKind::Android,
                _ => StudioDeviceKind::Computer,
            },
            name: cut(d.alias.trim(), 200),
            workspace: false,
            id: d.device_id,
        });
    let workspaces = workspaces
        .into_iter()
        .filter(|w| fits(&w.id))
        .map(|w| StudioDevice {
            kind: if w.environment == "chrome" {
                StudioDeviceKind::Chrome
            } else {
                StudioDeviceKind::Computer
            },
            name: cut(w.name.trim(), 200),
            workspace: true,
            id: w.id,
        });
    devices.chain(workspaces).collect()
}

/// The live memories of the page read, and how many of them are rules.
pub(crate) fn memory(list: MemoryList) -> StudioMemory {
    let read = list.items.len() as u64;
    let live: Vec<_> = list
        .items
        .into_iter()
        .filter(|m| m.archived_at.as_deref().is_none_or(str::is_empty))
        .collect();
    StudioMemory {
        memories: live.len() as u64,
        rules: live.iter().filter(|m| m.category == "procedural").count() as u64,
        more: list.total.is_some_and(|total| total > read),
    }
}

pub(crate) fn outputs(o: Outputs) -> StudioOutputs {
    StudioOutputs {
        count: o.total,
        latest_at: o.latest_at.filter(|at| !at.is_empty() && o.total > 0),
    }
}

pub(crate) fn theme(state: ThemeState) -> StudioTheme {
    StudioTheme {
        wallpaper: state.wallpaper().and_then(wallpaper),
    }
}

fn wallpaper(w: WallpaperSource) -> Option<StudioWallpaper> {
    let source = match w.kind.as_str() {
        "builtin" => StudioWallpaperSource::Builtin,
        "mine" => StudioWallpaperSource::Mine,
        "gallery" => StudioWallpaperSource::Gallery,
        _ => return None,
    };
    let id = cut(w.id.trim(), 128);
    (!id.is_empty()).then(|| StudioWallpaper {
        source,
        id,
        name: word(w.name, 200),
        author: word(w.author, 200),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn wire<T: serde::de::DeserializeOwned>(value: Value) -> T {
        serde_json::from_value(value).unwrap()
    }

    const LONG: &str = "x";

    #[test]
    fn a_channel_without_a_provider_says_unknown() {
        let pairing = wire(json!({ "id": "cp_1", "provider": "  ", "status": "active" }));
        let unnamed = channel(pairing).expect("the channel");
        assert_eq!(unnamed.provider, "unknown");
        let slack = wire(json!({ "id": "cp_2", "provider": "slack", "status": "active" }));
        assert_eq!(channel(slack).unwrap().provider, "slack");
    }

    #[test]
    fn rows_whose_ids_pass_128_characters_are_left_out() {
        let long = LONG.repeat(129);
        let fits = LONG.repeat(128);
        let pairing = |id: &str| wire(json!({ "id": id, "provider": "slack", "status": "active" }));
        assert!(channel(pairing(&long)).is_none());
        assert_eq!(channel(pairing(&fits)).unwrap().id, fits);

        let key = |id: &str| wire(json!({ "id": id, "name": "Shop", "agent_id": "ag_1" }));
        let keys = api_keys(vec![key(&long), key(&fits)], "ag_1");
        assert_eq!(
            keys.iter().map(|k| k.id.as_str()).collect::<Vec<_>>(),
            [fits.as_str()]
        );

        let device =
            |id: &str| wire(json!({ "device_id": id, "kind": "computer", "alias": "Mac" }));
        let space = |id: &str| {
            wire(json!({ "id": id, "environment": "chrome", "name": "Research", "state": "ready" }))
        };
        let listed = devices(
            vec![device(&long), device(&fits)],
            vec![space(&long), space("w1")],
        );
        let ids: Vec<&str> = listed.iter().map(|d| d.id.as_str()).collect();
        assert_eq!(ids, [fits.as_str(), "w1"]);
    }
}
