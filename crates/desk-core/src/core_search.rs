//! Search is a core primitive: plugins publish their own documents; only granted callers read them.
use crate::handler::{Answer, Core, denied, error, io_error, json};
use crate::perm::Target;
use desk_bridge::{
    ErrorCode, Permission, PluginKind, PluginStatus, SearchDocument, SearchHit, SearchKind,
    SearchOpenParams, SearchQueryParams, SearchQueryResult, SearchReplaceParams,
    SearchSystemParams,
};
use std::collections::{HashSet, VecDeque};
use std::path::PathBuf;
use std::time::{Duration, Instant};

// Kept in a separate namespace so store.set cannot forge or overwrite search documents.
const INDEX: &str = "\0search";
const MAX_INDEX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub(crate) struct RecentResults {
    next: u64,
    paths: VecDeque<(String, String, PathBuf, Instant)>,
}

impl Core {
    pub(crate) fn search_replace(&self, caller: &str, params: SearchReplaceParams) -> Answer {
        if !self
            .plugins()
            .iter()
            .any(|p| p.id == caller && p.enabled && p.status == PluginStatus::Ready)
        {
            return Err(error(
                ErrorCode::PermissionDenied,
                "Only enabled installed plugins publish documents".into(),
            ));
        }
        let mut ids = HashSet::new();
        let valid = params.documents.len() <= 500
            && params.documents.iter().all(|d| {
                !d.id.is_empty()
                    && d.id.chars().count() <= 256
                    && ids.insert(&d.id)
                    && !d.title.trim().is_empty()
                    && d.title.chars().count() <= 256
                    && d.detail.as_ref().is_none_or(|s| s.chars().count() <= 1024)
                    && d.text.as_ref().is_none_or(|s| s.chars().count() <= 16384)
                    && d.command
                        .as_ref()
                        .is_none_or(|c| c.starts_with(&format!("{caller}.")))
                    && (d.args.is_none() || d.command.is_some())
            });
        let value = serde_json::to_value(&params.documents)
            .map_err(|e| error(ErrorCode::InvalidParams, e.to_string()))?;
        if !valid || value.to_string().len() > MAX_INDEX_BYTES {
            return Err(error(
                ErrorCode::InvalidParams,
                "Invalid search documents or index exceeds 4 MiB".into(),
            ));
        }
        self.store
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .set_bounded(INDEX, caller, value, MAX_INDEX_BYTES)
            .map_err(|e| error(ErrorCode::IoError, e))?;
        json(serde_json::json!({}))
    }

    pub(crate) fn search_query(&self, caller: &str, params: SearchQueryParams) -> Answer {
        self.permissions()
            .authorize(caller, &Permission::SearchRead(params.scope), &Target::None)
            .map_err(denied)?;
        if params.query.chars().count() > 256
            || params.limit.is_some_and(|n| !(1..=100).contains(&n))
        {
            return Err(error(
                ErrorCode::InvalidParams,
                "Invalid query or limit".into(),
            ));
        }
        let query = params.query.trim().to_lowercase();
        let words: Vec<_> = query.split_whitespace().collect();
        let mut ranked = Vec::new();
        let plugins = self.plugins();
        let store = self.store.lock().unwrap_or_else(|e| e.into_inner());
        for plugin in plugins {
            let Some(manifest) = plugin.manifest else {
                continue;
            };
            if plugin.status != PluginStatus::Ready
                || manifest.kind != PluginKind::Ui
                || plugin.id == "desk.palette"
            {
                continue;
            }
            let detail = manifest.description.unwrap_or_default();
            let hit = SearchHit {
                id: format!("plugin:{}", plugin.id),
                title: manifest.name.unwrap_or_else(|| plugin.id.clone()),
                detail: Some(detail),
                kind: SearchKind::Plugin,
                plugin: Some(plugin.id.clone()),
                command: None,
                args: None,
            };
            if let Some(rank) = rank(&hit, &plugin.id, &query, &words) {
                ranked.push((rank, hit));
            }
            if !plugin.enabled {
                continue;
            }
            let docs: Vec<SearchDocument> = store
                .get(INDEX, &plugin.id)
                .and_then(|v| serde_json::from_value(v).ok())
                .unwrap_or_default();
            for doc in docs {
                let hit = SearchHit {
                    id: format!("document:{}:{}", plugin.id, doc.id),
                    title: doc.title,
                    detail: doc.detail,
                    kind: SearchKind::Document,
                    plugin: Some(plugin.id.clone()),
                    command: doc.command,
                    args: doc.args,
                };
                if let Some(rank) = rank(&hit, doc.text.as_deref().unwrap_or(""), &query, &words) {
                    ranked.push((rank, hit));
                }
            }
        }
        ranked.sort_by(|a, b| {
            a.0.cmp(&b.0)
                .then_with(|| a.1.title.cmp(&b.1.title))
                .then_with(|| a.1.id.cmp(&b.1.id))
        });
        json(SearchQueryResult {
            hits: ranked
                .into_iter()
                .take(params.limit.unwrap_or(40) as usize)
                .map(|(_, h)| h)
                .collect(),
        })
    }

    pub(crate) fn search_system(&self, caller: &str, params: SearchSystemParams) -> Answer {
        self.permissions()
            .authorize(
                caller,
                &Permission::SearchSystem(params.scope),
                &Target::None,
            )
            .map_err(denied)?;
        let paths = desk_sys::search::search(&params.query).map_err(io_error)?;
        let mut recent = self
            .search_results
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let mut seen = HashSet::new();
        let mut hits = Vec::new();
        for path in paths {
            if !seen.insert(path.clone()) {
                continue;
            }
            recent.next += 1;
            let id = format!("os:{}", recent.next);
            let title = path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            let application = path
                .extension()
                .is_some_and(|e| e == "app" || e == "exe" || e == "desktop" || e == "lnk");
            hits.push(SearchHit {
                id: id.clone(),
                title,
                detail: Some(path.to_string_lossy().into_owned()),
                kind: if application {
                    SearchKind::Application
                } else {
                    SearchKind::File
                },
                plugin: None,
                command: None,
                args: None,
            });
            recent
                .paths
                .push_back((id, caller.into(), path, Instant::now()));
        }
        while recent.paths.len() > 512 {
            recent.paths.pop_front();
        }
        json(SearchQueryResult { hits })
    }

    pub(crate) fn search_open(&self, caller: &str, params: SearchOpenParams) -> Answer {
        self.permissions()
            .authorize(
                caller,
                &Permission::SearchSystem(params.scope),
                &Target::None,
            )
            .map_err(denied)?;
        let path = self
            .search_results
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .paths
            .iter()
            .find(|(id, owner, _, at)| {
                id == &params.id && owner == caller && at.elapsed() < Duration::from_secs(300)
            })
            .map(|(_, _, path, _)| path.clone())
            .ok_or_else(|| {
                error(
                    ErrorCode::NotFound,
                    "Search again: this result expired".into(),
                )
            })?;
        desk_sys::search::open(&path).map_err(io_error)?;
        json(serde_json::json!({}))
    }
}

fn rank(hit: &SearchHit, text: &str, query: &str, words: &[&str]) -> Option<u8> {
    let title = hit.title.to_lowercase();
    let haystack =
        format!("{} {} {}", title, hit.detail.as_deref().unwrap_or(""), text).to_lowercase();
    if !words.iter().all(|word| haystack.contains(word)) {
        return None;
    }
    Some(if title == query {
        0
    } else if title.starts_with(query) {
        1
    } else if title.contains(query) {
        2
    } else {
        3
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Roots;
    use desk_bridge::SearchSystemPermission;

    #[test]
    fn an_os_result_belongs_to_one_caller_and_expires() {
        let core = Core::new(Roots {
            home: std::env::temp_dir(),
        });
        let scope = SearchSystemPermission {
            permission: Default::default(),
        };
        core.grant("a", Permission::SearchSystem(scope.clone()));
        core.grant("b", Permission::SearchSystem(scope.clone()));
        core.search_results.lock().unwrap().paths.push_back((
            "os:1".into(),
            "a".into(),
            PathBuf::from("/tmp/not-opened"),
            Instant::now(),
        ));
        let params = SearchOpenParams {
            id: "os:1".into(),
            scope,
        };
        assert_eq!(
            core.search_open("b", params.clone()).unwrap_err().code,
            ErrorCode::NotFound
        );
        core.search_results.lock().unwrap().paths[0].3 = Instant::now() - Duration::from_secs(301);
        assert_eq!(
            core.search_open("a", params).unwrap_err().code,
            ErrorCode::NotFound
        );
    }
}
