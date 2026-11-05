//! The memory side of `Core` (ADR 0095): memory.list, memory.get and memory.search under
//! memory:read; memory.remember and memory.forget under memory:write. The store is desk-memory's,
//! in the folder `with_memory_dir` names. The caller is the writer: the runtime writes for the
//! person, `agent:eris` is Eris. Every change goes to the holders of memory:read as memory.changed.

use std::path::PathBuf;
use std::sync::Arc;

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, MemoryChange, MemoryChangedData, MemoryChangedEvent,
    MemoryForgetParams, MemoryForgetResult, MemoryGetParams, MemoryGetResult, MemoryKind,
    MemoryListParams, MemoryListResult, MemoryReadPermission, MemoryRememberParams,
    MemoryRememberResult, MemorySearchParams, MemorySearchResult, MemoryWritePermission,
    Permission,
};
use desk_memory::{Memory, MemoryEpisode, MemoryError, MemoryStep};

use crate::handler::{Answer, Core, error, json};
use crate::perm::Target;

/// The page memory.list answers without a limit, and the hits memory.search does.
const LIST_DEFAULT: usize = 50;
const SEARCH_DEFAULT: usize = 20;

impl Core {
    /// Keep Eris's memory in `dir` (`<data>/memory` in the app). Without it memory.* answers
    /// `unsupported`. A folder that cannot be opened is said on stderr and leaves memory off.
    pub fn with_memory_dir(mut self, dir: PathBuf) -> Self {
        match Memory::open(&dir) {
            Ok(memory) => self.memory = Some(Arc::new(memory)),
            Err(why) => eprintln!("endue Desk: no memory ({why})"),
        }
        self
    }

    /// The store, for the core's own callers (Eris's turns, #468).
    pub fn memory(&self) -> Option<&Arc<Memory>> {
        self.memory.as_ref()
    }

    /// Keep an episode of a turn written by `caller`, and say so to the holders of memory:read.
    pub fn record_episode(
        &self,
        asked: &str,
        answered: &str,
        steps: Vec<MemoryStep>,
        caller: &str,
    ) -> Option<MemoryEpisode> {
        let episode = self
            .memory
            .as_ref()?
            .record(asked, answered, steps, &writer(caller))
            .map_err(|why| eprintln!("endue Desk: an episode was not kept ({why})"))
            .ok()?;
        self.memory_changed(
            MemoryChange::Recorded,
            vec![episode.id.clone()],
            Some(MemoryKind::Episode),
        );
        Some(episode)
    }

    pub(crate) fn memory_list(&self, caller: &str, params: MemoryListParams) -> Answer {
        let memory = self.reading(caller, params.scope)?;
        let limit = params
            .limit
            .map_or(LIST_DEFAULT, |n| usize::try_from(n).unwrap_or(LIST_DEFAULT));
        let page = memory
            .list(params.kind, limit, params.cursor.as_deref())
            .map_err(failed)?;
        json(MemoryListResult {
            entries: page.entries,
            next: page.next,
        })
    }

    pub(crate) fn memory_get(&self, caller: &str, params: MemoryGetParams) -> Answer {
        let memory = self.reading(caller, params.scope)?;
        let entry = memory.get(&params.id).map_err(failed)?;
        json(MemoryGetResult { entry })
    }

    pub(crate) fn memory_search(&self, caller: &str, params: MemorySearchParams) -> Answer {
        let memory = self.reading(caller, params.scope)?;
        let limit = params.limit.map_or(SEARCH_DEFAULT, |n| {
            usize::try_from(n).unwrap_or(SEARCH_DEFAULT)
        });
        let hits = memory
            .search(&params.query, params.kind, limit)
            .map_err(failed)?;
        json(MemorySearchResult { hits })
    }

    pub(crate) fn memory_remember(&self, caller: &str, params: MemoryRememberParams) -> Answer {
        let memory = self.writing(caller, params.scope)?;
        let (fact, change) = match &params.id {
            Some(id) => (
                memory.edit(id, &params.text, params.tags),
                MemoryChange::Edited,
            ),
            None => (
                memory.remember(&params.text, params.tags, &writer(caller)),
                MemoryChange::Remembered,
            ),
        };
        let fact = fact.map_err(failed)?;
        self.memory_changed(change, vec![fact.id.clone()], Some(MemoryKind::Fact));
        json(MemoryRememberResult { fact })
    }

    pub(crate) fn memory_forget(&self, caller: &str, params: MemoryForgetParams) -> Answer {
        let (forgotten, ids, kind) = match params {
            MemoryForgetParams::MemoryForgetOne(one) => {
                let memory = self.writing(caller, one.scope)?;
                let kind = if one.id.starts_with("ep_") {
                    MemoryKind::Episode
                } else {
                    MemoryKind::Fact
                };
                let forgotten = memory.forget(&one.id).map_err(failed)?;
                (forgotten, Some(vec![one.id]), Some(kind))
            }
            MemoryForgetParams::MemoryForgetAll(all) => {
                let memory = self.writing(caller, all.scope)?;
                (memory.forget_all(all.kind).map_err(failed)?, None, all.kind)
            }
        };
        if forgotten > 0 {
            self.memory_changed(MemoryChange::Forgotten, ids.unwrap_or_default(), kind);
        }
        json(MemoryForgetResult {
            forgotten: forgotten as u64,
        })
    }

    fn reading(
        &self,
        caller: &str,
        scope: MemoryReadPermission,
    ) -> Result<&Arc<Memory>, BridgeError> {
        self.check(caller, &Permission::MemoryRead(scope), &Target::None)?;
        self.memory_or_unsupported()
    }

    fn writing(
        &self,
        caller: &str,
        scope: MemoryWritePermission,
    ) -> Result<&Arc<Memory>, BridgeError> {
        self.check(caller, &Permission::MemoryWrite(scope), &Target::None)?;
        self.memory_or_unsupported()
    }

    fn memory_or_unsupported(&self) -> Result<&Arc<Memory>, BridgeError> {
        self.memory.as_ref().ok_or_else(|| {
            let message = "memory.* is not served: this desk keeps no memory".to_owned();
            error(ErrorCode::Unsupported, message)
        })
    }

    fn memory_changed(&self, change: MemoryChange, ids: Vec<String>, kind: Option<MemoryKind>) {
        let readers = self.holders(&Permission::MemoryRead(MemoryReadPermission {
            permission: Default::default(),
        }));
        let data = MemoryChangedData {
            change,
            ids: (!ids.is_empty()).then_some(ids),
            kind,
        };
        let event = MemoryChangedEvent {
            event: Default::default(),
            data,
        };
        self.events()
            .publish_to(readers, BridgeEvent::MemoryChanged(event));
    }
}

/// Who an entry says wrote it: the person for the runtime, eris for `agent:eris`, else the caller.
fn writer(caller: &str) -> String {
    match caller {
        "desk" => "person".to_owned(),
        "agent:eris" => "eris".to_owned(),
        other => other.to_owned(),
    }
}

fn failed(why: MemoryError) -> BridgeError {
    match why {
        MemoryError::NotFound(message) => error(ErrorCode::NotFound, message),
        MemoryError::Invalid(message) => error(ErrorCode::InvalidParams, message),
        MemoryError::Io(message) => error(ErrorCode::IoError, message),
    }
}
