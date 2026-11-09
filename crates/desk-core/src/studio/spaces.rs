//! studio.spaces.list and studio.spaces.get (ADR 0129): the endue AI spaces the person can open,
//! read through desk-platform under `studio:manage`. The list comes most recently active first; one
//! space's overview and rooms are read side by side, and a part endue AI did not answer for is named
//! in `problems` instead of failing the call. Only what the bridge names crosses it: no member, no
//! person's id, no attention item's reason, no billing, no remote picture, and a colour only as
//! `#rrggbb`.

use std::thread;

use desk_bridge::{
    ErrorCode, StudioSpace, StudioSpaceAgent, StudioSpaceAgentPermission, StudioSpaceCounts,
    StudioSpaceLatestResult, StudioSpaceParams, StudioSpacePart, StudioSpaceProblem,
    StudioSpaceResult, StudioSpaceRoom, StudioSpaceRoomThreads, StudioSpaceStatus,
    StudioSpaceSummary, StudioSpaceWork, StudioSpaceWorkStatus, StudioSpacesGetResult,
    StudioSpacesListParams, StudioSpacesListResult,
};
use desk_platform::Result as Platform;
use desk_platform::wire_spaces::{Room, Space, SpaceAgent, SpaceOverview, WorkItem, WorkResult};

use super::map::cut;
use super::serve::joined;
use crate::core_studio::failed;
use crate::handler::{Answer, Core, error, json};

/// Work items and results a space's answer lists.
const LISTED: usize = 5;

/// An id the bridge's patterns take: a letter or digit, then up to 127 of those, `_` or `-`.
fn id_of(text: &str) -> Option<String> {
    let mut chars = text.chars();
    let first = chars.next()?;
    let rest_ok = chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    (first.is_ascii_alphanumeric() && rest_ok && text.len() <= 128).then(|| text.to_owned())
}

/// Text that holds something, cut to `max` characters.
fn some_text(text: Option<String>, max: usize) -> Option<String> {
    text.map(|t| cut(t.trim(), max)).filter(|t| !t.is_empty())
}

/// A colour of the form #rrggbb, else none: it reaches a style attribute.
fn colour(text: Option<String>) -> Option<String> {
    text.filter(|c| {
        c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|d| d.is_ascii_hexdigit())
    })
}

/// The bridge's space; a deleted one is none.
pub(crate) fn space(space: Space) -> Option<StudioSpace> {
    let status = match space.status.as_deref() {
        Some("deleted") => return None,
        Some("archived") => StudioSpaceStatus::Archived,
        _ => StudioSpaceStatus::Active,
    };
    let summary = space.summary.map(|s| StudioSpaceSummary {
        active_work_items: s.active_work_items,
        open_attention_items: s.open_attention_items,
        latest_result: s.latest_result.and_then(|r| {
            Some(StudioSpaceLatestResult {
                id: some_text(Some(r.id), 128)?,
                title: cut(&r.title, 500),
                updated_at: r.updated_at,
            })
        }),
        last_activity_at: s.last_activity_at.filter(|t| !t.is_empty()),
    });
    Some(StudioSpace {
        id: id_of(&space.id)?,
        key: cut(&space.key, 128),
        name: cut(&space.name, 200),
        description: some_text(space.description, 2000),
        goal: some_text(space.goal, 2000),
        status,
        front_agent_id: space.front_agent_id.as_deref().and_then(id_of),
        avatar_color: colour(space.avatar_color),
        avatar_glyph: some_text(space.avatar_glyph, 16),
        summary,
        created_at: space.created_at,
        updated_at: space.updated_at,
    })
}

/// An agent still taking part; one that left is none.
fn agent(agent: SpaceAgent) -> Option<StudioSpaceAgent> {
    if agent.status != "active" {
        return None;
    }
    let permission = match agent.permission.as_deref() {
        Some("admin") => StudioSpaceAgentPermission::Admin,
        Some(_) => StudioSpaceAgentPermission::Participant,
        // endue AI derives it from the front seat where it keeps none.
        None if agent.is_front => StudioSpaceAgentPermission::Admin,
        None => StudioSpaceAgentPermission::Participant,
    };
    Some(StudioSpaceAgent {
        agent_id: id_of(&agent.agent_id)?,
        role_key: cut(&agent.role_key, 64),
        front: agent.is_front,
        permission,
    })
}

/// A piece of work in a status the bridge has a word for; another status is none.
fn work(item: WorkItem) -> Option<StudioSpaceWork> {
    use StudioSpaceWorkStatus as S;
    let status = match item.display_status.as_str() {
        "queued" => S::Queued,
        "preparing" => S::Preparing,
        "in_progress" => S::InProgress,
        "needs_you" => S::NeedsYou,
        "stopping" => S::Stopping,
        "pausing" => S::Pausing,
        "paused" => S::Paused,
        "done" => S::Done,
        "partly_done" => S::PartlyDone,
        "failed" => S::Failed,
        "stopped" => S::Stopped,
        _ => return None,
    };
    Some(StudioSpaceWork {
        id: some_text(Some(item.id), 128)?,
        title: cut(&item.title, 500),
        status,
        updated_at: item.updated_at,
    })
}

fn result(result: WorkResult) -> Option<StudioSpaceResult> {
    Some(StudioSpaceResult {
        id: some_text(Some(result.id), 128)?,
        title: cut(&result.title, 500),
        kind: some_text(result.kind, 64),
        updated_at: result.updated_at,
    })
}

/// A room that is open; an archived or deleted one is none.
fn room(room: Room) -> Option<StudioSpaceRoom> {
    if !(room.status.is_empty() || room.status == "active") {
        return None;
    }
    Some(StudioSpaceRoom {
        id: some_text(Some(room.id), 128)?,
        name: cut(&room.name, 200),
        topic: some_text(room.topic, 2000),
        unread_count: room.unread_count,
        last_message_at: room.last_message_at.filter(|t| !t.is_empty()),
        discussing: room.active_discussion.is_some(),
        threads: room.threads.map(|t| StudioSpaceRoomThreads {
            active: t.active,
            needs_you: t.needs_you,
            unread: t.unread,
        }),
    })
}

/// When a space was last active, for the list's order.
fn last_active(space: &StudioSpace) -> &str {
    space
        .summary
        .as_ref()
        .and_then(|s| s.last_activity_at.as_deref())
        .unwrap_or(&space.updated_at)
}

/// A part's answer, or its problem.
fn part<T>(
    part: StudioSpacePart,
    answer: Platform<T>,
    problems: &mut Vec<StudioSpaceProblem>,
) -> Option<T> {
    match answer {
        Ok(value) => Some(value),
        Err(e) => {
            let error = failed(e);
            problems.push(StudioSpaceProblem {
                part,
                code: error.code,
                message: cut(&error.message, 2000),
            });
            None
        }
    }
}

impl Core {
    pub(crate) fn studio_spaces_list(
        &self,
        caller: &str,
        params: StudioSpacesListParams,
    ) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let archived = params.archived.unwrap_or(false);
        let wanted = if archived {
            StudioSpaceStatus::Archived
        } else {
            StudioSpaceStatus::Active
        };
        let mut spaces: Vec<StudioSpace> = platform
            .spaces(archived)
            .map_err(failed)?
            .into_iter()
            .filter_map(space)
            .filter(|s| s.status == wanted)
            .collect();
        // ISO times of one form sort as text: the most recently active first, then by name.
        spaces.sort_by(|a, b| {
            last_active(b)
                .cmp(last_active(a))
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        json(StudioSpacesListResult { spaces })
    }

    pub(crate) fn studio_spaces_get(&self, caller: &str, params: StudioSpaceParams) -> Answer {
        let platform = self.platform_for(caller, params.scope)?;
        let id = params.space_id.as_str();
        let found = platform.space(id).map_err(failed)?;
        let space = space(found)
            .ok_or_else(|| error(ErrorCode::NotFound, format!("the space {id} was deleted")))?;
        let p = platform.as_ref();
        let (overview, rooms) = thread::scope(|s| {
            let overview = s.spawn(|| p.space_overview(id));
            let rooms = s.spawn(|| p.space_rooms(id));
            (joined(overview), joined(rooms))
        });
        let mut problems = Vec::new();
        let overview: Option<SpaceOverview> =
            part(StudioSpacePart::Overview, overview, &mut problems);
        let rooms = part(StudioSpacePart::Rooms, rooms, &mut problems).unwrap_or_default();
        let (counts, mut agents, work_items, results) = match overview {
            Some(o) => (
                Some(StudioSpaceCounts {
                    active_work_items: o.counts.active_work_items,
                    open_attention_items: o.counts.open_attention_items,
                    results: o.counts.results,
                }),
                o.agents.into_iter().filter_map(agent).collect::<Vec<_>>(),
                o.active_work_items
                    .into_iter()
                    .filter_map(work)
                    .take(LISTED)
                    .collect(),
                o.recent_results
                    .into_iter()
                    .filter_map(result)
                    .take(LISTED)
                    .collect(),
            ),
            None => (None, Vec::new(), Vec::new(), Vec::new()),
        };
        // The front agent first, the rest as endue AI listed them.
        agents.sort_by_key(|a| !a.front);
        json(StudioSpacesGetResult {
            space,
            counts,
            agents,
            work: work_items,
            results,
            rooms: rooms.into_iter().filter_map(room).collect(),
            problems,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_hex_colour_reaches_the_bridge() {
        assert_eq!(colour(Some("#B6a3F5".into())).as_deref(), Some("#B6a3F5"));
        assert_eq!(colour(Some("red".into())), None);
        assert_eq!(colour(Some("#fff".into())), None);
        assert_eq!(colour(Some("#B6A3F5;x:y".into())), None);
    }

    #[test]
    fn ids_keep_the_bridge_pattern() {
        assert_eq!(id_of("ag_01-x").as_deref(), Some("ag_01-x"));
        assert_eq!(id_of("_ag"), None);
        assert_eq!(id_of("ag/../x"), None);
        assert_eq!(id_of(""), None);
    }
}
