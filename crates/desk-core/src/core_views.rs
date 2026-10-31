//! The view side of `Core`: view.list, get, save and remove under `view:manage`, over the person's
//! view files, `~/.desk/views/<id>.yaml` (specs/view/v0, ADR 0032). Views are read from disk on
//! every call. A file must pass the schema and `desk_bridge::view_problems` and be named after the
//! id inside it; one that does not is left out of view.list, view.get names it, and
//! `Core::view_problems` lists it. view.save checks the same and writes YAML atomically.
//! `view.changed` goes to the `view:manage` holders, once per change, whoever made it.

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{MutexGuard, OnceLock};

use desk_bridge::{
    BridgeError, BridgeEvent, ErrorCode, Permission, View, ViewChange, ViewChangedData,
    ViewChangedEvent, ViewGetParams, ViewGetResult, ViewListParams, ViewListResult,
    ViewManagePermission, ViewRemoveParams, ViewRemoveResult, ViewSaveParams, ViewSaveResult,
    ViewSummary, view_problems,
};
use serde_json::{Value, json};

use crate::handler::{Answer, Core, error, io_error, json as answer};
use crate::manifest::schema_registry;
use crate::perm::Target;

const VIEW_SCHEMA: &str = "https://endue.ai/specs/view/v0/view.schema.json#/$defs/View";

/// The text of each view file last announced as saved, so a change is announced once: the core's
/// own writes and the watcher's sightings of them meet here.
#[derive(Default)]
pub(crate) struct ViewsSeen(BTreeMap<String, String>);

/// A view file as read from disk.
pub(crate) enum ViewFile {
    Valid(Box<View>, String),
    /// What is wrong, naming the file.
    Invalid(String),
}

impl Core {
    /// Problems with the files in the views folder, each naming its file: those are left out.
    pub fn view_problems(&self) -> Vec<String> {
        self.view_files()
            .into_iter()
            .filter_map(|(_, file)| match file {
                ViewFile::Invalid(problem) => Some(problem),
                ViewFile::Valid(..) => None,
            })
            .collect()
    }

    pub(crate) fn view_list(&self, caller: &str, params: ViewListParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let mut views: Vec<ViewSummary> = self
            .view_files()
            .into_iter()
            .filter_map(|(_, file)| match file {
                ViewFile::Valid(view, _) => Some(ViewSummary {
                    id: view.id,
                    version: view.version,
                    title: view.title,
                    description: view.description,
                }),
                ViewFile::Invalid(_) => None,
            })
            .collect();
        views.sort_by(|a, b| a.id.cmp(&b.id));
        answer(ViewListResult { views })
    }

    pub(crate) fn view_get(&self, caller: &str, params: ViewGetParams) -> Answer {
        self.check_views(caller, params.scope)?;
        match read_view(&self.view_path(&params.id)?) {
            Ok(ViewFile::Valid(view, _)) => answer(ViewGetResult { view: *view }),
            Ok(ViewFile::Invalid(problem)) => Err(error(ErrorCode::InvalidParams, problem)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Err(no_view(&params.id)),
            Err(e) => Err(io_error(e)),
        }
    }

    pub(crate) fn view_save(&self, caller: &str, params: ViewSaveParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let value = serde_json::to_value(&params.view)
            .map_err(|e| error(ErrorCode::Internal, e.to_string()))?;
        let mut problems = schema_problems(&value);
        if problems.is_empty() {
            problems.extend(view_problems(&params.view));
        }
        if !problems.is_empty() {
            let why = format!("the view is not valid: {}", problems.join("; "));
            return Err(error(ErrorCode::InvalidParams, why));
        }
        let id = params.view.id.clone();
        let path = self.view_path(&id)?;
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

    pub(crate) fn view_remove(&self, caller: &str, params: ViewRemoveParams) -> Answer {
        self.check_views(caller, params.scope)?;
        let path = self.view_path(&params.id)?;
        {
            let mut seen = self.views_seen();
            std::fs::remove_file(&path).map_err(|e| match e.kind() {
                io::ErrorKind::NotFound => no_view(&params.id),
                _ => io_error(e),
            })?;
            seen.0.remove(&params.id);
        }
        self.view_changed(&params.id, ViewChange::Removed);
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
    /// breaks is not announced; one that goes is `removed` if it had been announced.
    pub(crate) fn view_file_changed(&self, id: &str) {
        let path = self.views_folder().join(format!("{id}.yaml"));
        let change = {
            let mut seen = self.views_seen();
            match read_view(&path) {
                Ok(ViewFile::Valid(_, text)) if seen.0.get(id) != Some(&text) => {
                    seen.0.insert(id.to_owned(), text);
                    Some(ViewChange::Saved)
                }
                Err(e) if e.kind() == io::ErrorKind::NotFound => {
                    seen.0.remove(id).map(|_| ViewChange::Removed)
                }
                _ => None,
            }
        };
        if let Some(change) = change {
            self.view_changed(id, change);
        }
    }

    /// Every `*.yaml` file in the views folder, by name, as read.
    fn view_files(&self) -> Vec<(String, ViewFile)> {
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
    fn view_changed(&self, id: &str, change: ViewChange) {
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

/// Read and check one view file. A file that cannot be read at all is the io error.
pub(crate) fn read_view(path: &Path) -> io::Result<ViewFile> {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let bytes = std::fs::read(path)?;
    let invalid = |why: String| Ok(ViewFile::Invalid(format!("{name}{why}")));
    let Ok(text) = String::from_utf8(bytes) else {
        return invalid(": not UTF-8".to_owned());
    };
    let value = match yaml_serde::from_str::<Option<Value>>(&text) {
        Ok(value) => value.unwrap_or(Value::Null),
        Err(e) => return invalid(format!(": not YAML: {e}")),
    };
    let problems = schema_problems(&value);
    if !problems.is_empty() {
        return invalid(problems.join(&format!("; {name}")));
    }
    let view: View = match serde_json::from_value(value) {
        Ok(view) => view,
        Err(e) => return invalid(format!(": not a view: {e}")),
    };
    let named = view_problems(&view);
    if !named.is_empty() {
        return invalid(named.join(&format!("; {name}")));
    }
    let stem = name.strip_suffix(".yaml").unwrap_or(&name);
    if view.id != stem {
        return invalid(format!(
            ": its id is {}; name the file {}.yaml",
            view.id, view.id
        ));
    }
    Ok(ViewFile::Valid(Box::new(view), text))
}

/// Where `value` breaks specs/view/v0, each as `<pointer>: <problem>`.
fn schema_problems(value: &Value) -> Vec<String> {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    let validator = VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": VIEW_SCHEMA }))
            .expect("the view schema compiles")
    });
    validator
        .iter_errors(value)
        .map(|e| format!("{}: {e}", e.instance_path()))
        .collect()
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
