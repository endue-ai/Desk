//! The view side of `Core`: view.list, get, save and remove under `view:manage`, over the person's
//! view files, `~/.desk/views/<id>.yaml`, each an item view (specs/view/v0, ADR 0032) or a universal
//! view (ADR 0087, ADR 0102), and the view plugins' views (`core_plugin_views`), which a person's file
//! of the same id shadows and which are read-only. Files are read from disk on every call. A file
//! must pass its language's check (`core_views_check`) and be named after the id inside it; one that
//! does not is left out of view.list, view.get names it, and `Core::view_problems` lists it.
//! view.save checks the same and writes YAML atomically. `view.changed` goes to the `view:manage` holders, once per change,
//! whoever made it.

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::PathBuf;
use std::sync::MutexGuard;

use desk_bridge::{
    AnyView, BridgeError, BridgeEvent, ErrorCode, Permission, ViewChange, ViewChangedData,
    ViewChangedEvent, ViewGetParams, ViewGetResult, ViewListParams, ViewListResult,
    ViewManagePermission, ViewRemoveParams, ViewRemoveResult, ViewSaveParams, ViewSaveResult,
    ViewSource, ViewSummary,
};

pub(crate) use crate::core_views_check::{ViewFile, check_view, parse_view, read_view};
use crate::core_views_check::{check_any_view, id_of, summary};
use crate::handler::{Answer, Core, error, io_error, json as answer};
use crate::perm::Target;

/// The text of each view file last announced as saved, so a change is announced once: the core's
/// own writes and the watcher's sightings of them meet here.
#[derive(Default)]
pub(crate) struct ViewsSeen(BTreeMap<String, String>);

impl Core {
    /// Problems with the files in the views folder, each naming its file, then with the view
    /// plugins' views, each naming its plugin and file: those are left out.
    pub fn view_problems(&self) -> Vec<String> {
        let mut problems: Vec<String> = self
            .view_files()
            .into_iter()
            .filter_map(|(_, file)| match file {
                ViewFile::Invalid(problem) => Some(problem),
                ViewFile::Valid(..) => None,
            })
            .collect();
        problems.extend(self.plugin_view_problems());
        problems
    }

    pub(crate) fn view_list(&self, caller: &str, params: ViewListParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let files = self.view_files();
        let shadowed: BTreeSet<String> = files.iter().map(|(id, _)| id.clone()).collect();
        let mut views: Vec<ViewSummary> = files
            .into_iter()
            .filter_map(|(_, file)| match file {
                ViewFile::Valid(view, _) => Some(summary(*view, ViewSource::File, None)),
                ViewFile::Invalid(_) => None,
            })
            .collect();
        for (id, (plugin, view)) in self.plugin_views() {
            if !shadowed.contains(&id) {
                views.push(summary(AnyView::View(view), ViewSource::Plugin, Some(plugin)));
            }
        }
        views.sort_by(|a, b| a.id.cmp(&b.id));
        answer(ViewListResult { views })
    }

    pub(crate) fn view_get(&self, caller: &str, params: ViewGetParams) -> Answer {
        self.check_views(caller, params.scope)?;
        match read_view(&self.view_path(&params.id)?) {
            Ok(ViewFile::Valid(view, _)) => answer(ViewGetResult {
                view: *view,
                source: ViewSource::File,
                plugin: None,
            }),
            Ok(ViewFile::Invalid(problem)) => Err(error(ErrorCode::InvalidParams, problem)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => match self.plugin_view(&params.id) {
                Some((plugin, view)) => answer(ViewGetResult {
                    view: AnyView::View(view),
                    source: ViewSource::Plugin,
                    plugin: Some(plugin),
                }),
                None => Err(no_view(&params.id)),
            },
            Err(e) => Err(io_error(e)),
        }
    }

    pub(crate) fn view_save(&self, caller: &str, params: ViewSaveParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let value = serde_json::to_value(&params.view)
            .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
        let invalid = |why: String| error(ErrorCode::InvalidParams, why);
        let view = check_any_view("", value.clone())
            .map_err(|problems| invalid(format!("the view is not valid: {problems}")))?;
        let Some(id) = id_of(&view).map(str::to_owned) else {
            return Err(invalid(
                "the view is not valid: a universal view needs its id to be saved".to_owned(),
            ));
        };
        let path = self.view_path(&id)?;
        if !path.exists()
            && let Some((plugin, _)) = self.plugin_view(&id)
        {
            let why = format!("{id} is owned by plugin {plugin}; save it under another id");
            return Err(invalid(why));
        }
        let text =
            yaml_serde::to_string(&value).map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
        {
            let mut seen = self.views_seen();
            desk_sys::fs::write(&path, text.as_bytes(), true).map_err(io_error)?;
            seen.0.insert(id.clone(), text);
        }
        self.view_changed(&id, ViewChange::Saved);
        answer(ViewSaveResult {})
    }

    /// Delete the person's file. A plugin's view of the id, if any, answers view.get after it.
    pub(crate) fn view_remove(&self, caller: &str, params: ViewRemoveParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let path = self.view_path(&params.id)?;
        let owner = self.plugin_view(&params.id).map(|(plugin, _)| plugin);
        {
            let mut seen = self.views_seen();
            std::fs::remove_file(&path).map_err(|e| match (e.kind(), &owner) {
                (io::ErrorKind::NotFound, Some(plugin)) => {
                    let why = format!("{} is a view of plugin {plugin}, read-only", params.id);
                    error(ErrorCode::InvalidParams, why)
                }
                (io::ErrorKind::NotFound, None) => no_view(&params.id),
                _ => io_error(e),
            })?;
            seen.0.remove(&params.id);
        }
        self.view_changed(&params.id, shown(owner.is_some()));
        answer(ViewRemoveResult {})
    }

    /// `~/.desk/views`.
    pub(crate) fn views_folder(&self) -> PathBuf {
        self.home().join(".desk").join("views")
    }

    /// Remember the valid files as they are now, so only later changes are announced.
    pub(crate) fn remember_views(&self) {
        let files = self.view_files();
        let mut seen = self.views_seen();
        seen.0.clear();
        for (id, file) in files {
            if let ViewFile::Valid(_, text) = file {
                seen.0.insert(id, text);
            }
        }
    }

    /// The file of view `id` may have changed on disk: announce it once if it did. A file that
    /// breaks is not announced; one that goes is `removed` if it had been announced, or `saved`
    /// when a plugin's view of its id answers now.
    pub(crate) fn view_file_changed(&self, id: &str) {
        let path = self.views_folder().join(format!("{id}.yaml"));
        let provided = self.plugin_view(id).is_some();
        let change = {
            let mut seen = self.views_seen();
            match read_view(&path) {
                Ok(ViewFile::Valid(_, text)) if seen.0.get(id) != Some(&text) => {
                    seen.0.insert(id.to_owned(), text);
                    Some(ViewChange::Saved)
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    seen.0.remove(id).map(|_| shown(provided))
                }
                _ => None,
            }
        };
        if let Some(change) = change {
            self.view_changed(id, change);
        }
    }

    /// Every `*.yaml` file in the views folder, by name, as read.
    pub(crate) fn view_files(&self) -> Vec<(String, ViewFile)> {
        let Ok(entries) = std::fs::read_dir(self.views_folder()) else {
            return Vec::new();
        };
        let mut files: Vec<(String, PathBuf)> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().into_owned();
                let id = name.strip_suffix(".yaml")?.to_owned();
                (!id.starts_with('.') && entry.path().is_file()).then(|| (id, entry.path()))
            })
            .collect();
        files.sort();
        files
            .into_iter()
            .filter_map(|(id, path)| read_view(&path).ok().map(|file| (id, file)))
            .collect()
    }

    /// The file of view `id`; an id that is not a view id is `invalid_params`.
    fn view_path(&self, id: &str) -> Result<PathBuf, BridgeError> {
        if !view_id(id) {
            let why = format!("{id:?} is not a view id (lowercase and dotted: example.today)");
            return Err(error(ErrorCode::InvalidParams, why));
        }
        Ok(self.views_folder().join(format!("{id}.yaml")))
    }

    fn check_views(&self, caller: &str, scope: ViewManagePermission) -> Result<(), BridgeError> {
        self.check(caller, &Permission::ViewManage(scope), &Target::None)
    }

    /// `view.changed` for the view:manage holders.
    pub(crate) fn view_changed(&self, id: &str, change: ViewChange) {
        let scope = Permission::ViewManage(ViewManagePermission {
            permission: Default::default(),
        });
        let to = self.holders(&scope);
        let data = ViewChangedData {
            id: id.to_owned(),
            change,
        };
        let event = BridgeEvent::ViewChanged(ViewChangedEvent {
            event: Default::default(),
            data,
        });
        self.events().publish_to(to, event);
    }

    fn views_seen(&self) -> MutexGuard<'_, ViewsSeen> {
        self.views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// What a change means for view.get: `saved` when an id still answers (a plugin's view under the
/// person's file that went), `removed` when it no longer does.
pub(crate) fn shown(answers: bool) -> ViewChange {
    if answers {
        ViewChange::Saved
    } else {
        ViewChange::Removed
    }
}

/// `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`, the spec's ViewId.
fn view_id(id: &str) -> bool {
    let segments: Vec<&str> = id.split('.').collect();
    segments.len() >= 2
        && id.len() <= 128
        && segments.iter().all(|s| {
            s.starts_with(|c: char| c.is_ascii_lowercase())
                && s.chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        })
}

fn no_view(id: &str) -> BridgeError {
    error(ErrorCode::NotFound, format!("there is no view {id}"))
}
