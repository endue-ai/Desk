//! The bridge's side of the dialogs (#308): `dialog.open` and `dialog.save` from plugins, shown as the
//! desk's own open dialog is (`super::start`) and as an `rfd` save dialog, both over the main window.
//! The core grants what the person chose; this only shows the dialogs and says what was chosen.

use std::path::PathBuf;

use desk_bridge::{DialogFilter, DialogOpenKind, DialogOpenParams, DialogSaveParams};
use desk_core::{DialogError, Dialogs};

use super::{Filter, Options, on_the_loop, pick};
use crate::pump::Pump;

/// The dialogs the shell gives the core once the desk is up.
pub struct ShellDialogs {
    pump: Pump,
    home: PathBuf,
}

impl ShellDialogs {
    pub fn new(pump: Pump, home: PathBuf) -> Self {
        Self { pump, home }
    }
}

/// A bridge path as the OS names it: `~` and `${home}` are the home folder.
pub(crate) fn local(path: &str, home: &std::path::Path) -> PathBuf {
    let rest = (path.strip_prefix("${home}"))
        .or_else(|| path.strip_prefix('~'))
        .filter(|rest| rest.is_empty() || rest.starts_with('/'));
    match rest {
        Some(rest) => home.join(rest.trim_start_matches('/')),
        None => PathBuf::from(path),
    }
}

fn filters(filters: Option<&Vec<DialogFilter>>) -> Vec<Filter> {
    (filters.into_iter().flatten())
        .map(|filter| Filter {
            name: filter.name.clone(),
            extensions: filter.extensions.clone(),
        })
        .collect()
}

/// The desk's open options for a plugin's `dialog.open`.
pub(crate) fn open_options(params: &DialogOpenParams, home: &std::path::Path) -> Options {
    Options {
        multiple: params.multiple == Some(true),
        directory: params.kind == Some(DialogOpenKind::Folders),
        title: params.title.clone(),
        default_path: (params.start_in.as_deref()).map(|p| local(p, home).to_string_lossy().into()),
        filters: filters(params.filters.as_ref()),
    }
}

/// The save dialog `params` asks for, over `parent`. Call on the event loop's thread.
fn start_save(
    params: DialogSaveParams,
    home: PathBuf,
    parent: Option<&winit::window::Window>,
) -> std::pin::Pin<Box<dyn Future<Output = Option<PathBuf>> + Send>> {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
    }
    if let Some(title) = &params.title {
        dialog = dialog.set_title(title);
    }
    if let Some(folder) = &params.start_in {
        dialog = dialog.set_directory(local(folder, &home));
    }
    if let Some(name) = &params.suggested_name {
        dialog = dialog.set_file_name(name);
    }
    for filter in filters(params.filters.as_ref()) {
        dialog = dialog.add_filter(&filter.name, &filter.extensions);
    }
    let saving = dialog.save_file();
    Box::pin(async move { saving.await.map(|handle| handle.path().to_owned()) })
}

impl Dialogs for ShellDialogs {
    fn open(&self, params: &DialogOpenParams) -> Result<Option<Vec<PathBuf>>, DialogError> {
        pick(&self.pump, open_options(params, &self.home)).map_err(DialogError::Failed)
    }

    fn save(&self, params: &DialogSaveParams) -> Result<Option<PathBuf>, DialogError> {
        let (params, home) = (params.clone(), self.home.clone());
        on_the_loop(&self.pump, move |parent| start_save(params, home, parent))
            .map_err(DialogError::Failed)
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use desk_bridge::DialogOpenParams;
    use serde_json::json;

    use super::{Filter, local, open_options};

    #[test]
    fn a_plugins_open_asks_for_what_its_params_say() {
        let params: DialogOpenParams = serde_json::from_value(json!({
            "kind": "folders", "multiple": true, "title": "Pick", "startIn": "~/Notes",
            "filters": [{ "name": "Markdown", "extensions": ["md"] }],
        }))
        .unwrap();
        let options = open_options(&params, Path::new("/Users/person"));
        assert!(options.multiple && options.directory);
        assert_eq!(options.title.as_deref(), Some("Pick"));
        assert_eq!(options.default_path.as_deref(), Some("/Users/person/Notes"));
        let markdown = Filter {
            name: "Markdown".into(),
            extensions: vec!["md".into()],
        };
        assert_eq!(options.filters, [markdown]);
        let none = open_options(&serde_json::from_value(json!({})).unwrap(), Path::new("/h"));
        assert!(!none.multiple && !none.directory && none.default_path.is_none());
    }

    #[test]
    fn home_paths_are_the_home_folder() {
        let home = Path::new("/Users/person");
        assert_eq!(local("~", home), PathBuf::from("/Users/person"));
        assert_eq!(
            local("${home}/Notes", home),
            PathBuf::from("/Users/person/Notes")
        );
        assert_eq!(local("/tmp/x", home), PathBuf::from("/tmp/x"));
        assert_eq!(local("~other/x", home), PathBuf::from("~other/x"));
    }
}
