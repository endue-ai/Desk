//! The bridge's side of the dialogs (#308): `dialog.open` and `dialog.save` from plugins, shown as the
//! desk's own open dialog is (`super::start`) and as an `rfd` save dialog, both over the main window.
//! The core grants what the person chose; this only shows the dialogs and says what was chosen.
//! Each title says who asks (`Notes: Open a note`; without one of its own, Open or Save in the desk's
//! language, ADR 0276), one dialog shows at a time (a second waits),
//! and a desk without a main window answers `unsupported` rather than show one unattached.

use std::path::PathBuf;

use desk_bridge::{DialogFilter, DialogOpenKind, DialogOpenParams, DialogSaveParams};
use desk_core::{Asker, DialogError, Dialogs};

use super::{Filter, NotShown, Options, on_the_loop, start};
use crate::pump::Pump;
use crate::words::{Language, text};

/// The dialogs the shell gives the core once the desk is up.
pub struct ShellDialogs {
    pump: Pump,
    home: PathBuf,
    /// Held while a dialog shows: the next one waits for the person's answer to this one.
    one: std::sync::Mutex<()>,
}

impl ShellDialogs {
    pub fn new(pump: Pump, home: PathBuf) -> Self {
        Self {
            pump,
            home,
            one: std::sync::Mutex::new(()),
        }
    }
}

/// A dialog's title: who asks, then what for (`what` when the caller names nothing).
pub(crate) fn titled(asker: &Asker, title: Option<&str>, what: &str) -> String {
    format!("{}: {}", asker.name, title.unwrap_or(what))
}

fn not_shown(why: NotShown) -> DialogError {
    match why {
        NotShown::NoWindow => DialogError::Unsupported(why.to_string()),
        NotShown::DidNotOpen => DialogError::Failed(why.to_string()),
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

/// The desk's open options for a plugin's `dialog.open`, titled in `language`.
pub(crate) fn open_options(
    asker: &Asker,
    params: &DialogOpenParams,
    home: &std::path::Path,
    language: Language,
) -> Options {
    let open = text(language, "desk.dialog.open");
    Options {
        multiple: params.multiple == Some(true),
        directory: params.kind == Some(DialogOpenKind::Folders),
        title: Some(titled(asker, params.title.as_deref(), &open)),
        default_path: (params.start_in.as_deref()).map(|p| local(p, home).to_string_lossy().into()),
        filters: filters(params.filters.as_ref()),
    }
}

/// What the save dialog is told: its title, folder, suggested name and filters.
#[derive(Debug, PartialEq)]
pub(crate) struct SaveOptions {
    pub title: String,
    pub directory: Option<PathBuf>,
    pub file_name: Option<String>,
    pub filters: Vec<Filter>,
}

/// The save options for a plugin's `dialog.save`, titled in `language`.
pub(crate) fn save_options(
    asker: &Asker,
    params: &DialogSaveParams,
    home: &std::path::Path,
    language: Language,
) -> SaveOptions {
    let save = text(language, "desk.dialog.save");
    SaveOptions {
        title: titled(asker, params.title.as_deref(), &save),
        directory: (params.start_in.as_deref()).map(|p| local(p, home)),
        file_name: params.suggested_name.clone(),
        filters: filters(params.filters.as_ref()),
    }
}

/// The save dialog `options` asks for, over `parent`. Call on the event loop's thread.
fn start_save(
    options: SaveOptions,
    parent: Option<&winit::window::Window>,
) -> std::pin::Pin<Box<dyn Future<Output = Option<PathBuf>> + Send>> {
    let mut dialog = rfd::AsyncFileDialog::new().set_title(&options.title);
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
    }
    if let Some(folder) = &options.directory {
        dialog = dialog.set_directory(folder);
    }
    if let Some(name) = &options.file_name {
        dialog = dialog.set_file_name(name);
    }
    for filter in &options.filters {
        dialog = dialog.add_filter(&filter.name, &filter.extensions);
    }
    let saving = dialog.save_file();
    Box::pin(async move { saving.await.map(|handle| handle.path().to_owned()) })
}

impl Dialogs for ShellDialogs {
    fn open(
        &self,
        asker: &Asker,
        params: &DialogOpenParams,
    ) -> Result<Option<Vec<PathBuf>>, DialogError> {
        let _one = self.one.lock().unwrap_or_else(|e| e.into_inner());
        let options = open_options(asker, params, &self.home, crate::language::in_force());
        on_the_loop(&self.pump, true, move |parent| start(options, parent)).map_err(not_shown)
    }

    fn save(
        &self,
        asker: &Asker,
        params: &DialogSaveParams,
    ) -> Result<Option<PathBuf>, DialogError> {
        let _one = self.one.lock().unwrap_or_else(|e| e.into_inner());
        let options = save_options(asker, params, &self.home, crate::language::in_force());
        on_the_loop(&self.pump, true, move |parent| start_save(options, parent)).map_err(not_shown)
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use desk_bridge::{DialogOpenParams, DialogSaveParams};
    use desk_core::{Asker, DialogError};
    use serde_json::json;

    use super::{Filter, NotShown, SaveOptions, local, not_shown, open_options, save_options};
    use crate::words::Language;

    fn notes() -> Asker {
        Asker {
            caller: "endue.notes".into(),
            name: "Notes".into(),
        }
    }

    fn fixture_home() -> &'static Path {
        Path::new(if cfg!(windows) { r"C:\endue" } else { "/endue" })
    }

    fn markdown() -> Filter {
        Filter {
            name: "Markdown".into(),
            extensions: vec!["md".into()],
        }
    }

    #[test]
    fn a_plugins_open_asks_for_what_its_params_say_under_its_name() {
        let params: DialogOpenParams = serde_json::from_value(json!({
            "kind": "folders", "multiple": true, "title": "Pick", "startIn": "~/Notes",
            "filters": [{ "name": "Markdown", "extensions": ["md"] }],
        }))
        .unwrap();
        let options = open_options(&notes(), &params, fixture_home(), Language::En);
        assert!(options.multiple && options.directory);
        assert_eq!(options.title.as_deref(), Some("Notes: Pick"));
        assert_eq!(
            options.default_path.as_deref().map(Path::new),
            Some(fixture_home().join("Notes").as_path())
        );
        assert_eq!(options.filters, [markdown()]);
        let none: DialogOpenParams = serde_json::from_value(json!({})).unwrap();
        let korean = open_options(&notes(), &none, fixture_home(), Language::Ko);
        assert_eq!(korean.title.as_deref(), Some("Notes: 열기"));
        let none = open_options(&notes(), &none, fixture_home(), Language::En);
        assert!(!none.multiple && !none.directory && none.default_path.is_none());
        assert_eq!(none.title.as_deref(), Some("Notes: Open"));
    }

    #[test]
    fn a_plugins_save_suggests_its_name_in_its_folder_under_its_name() {
        let params: DialogSaveParams = serde_json::from_value(json!({
            "title": "Save the note as", "suggestedName": "a.md", "startIn": "${home}/Notes",
            "filters": [{ "name": "Markdown", "extensions": ["md"] }],
        }))
        .unwrap();
        assert_eq!(
            save_options(&notes(), &params, fixture_home(), Language::Ko),
            SaveOptions {
                title: "Notes: Save the note as".into(),
                directory: Some(fixture_home().join("Notes")),
                file_name: Some("a.md".into()),
                filters: vec![markdown()],
            }
        );
        let none: DialogSaveParams = serde_json::from_value(json!({})).unwrap();
        let korean = save_options(&notes(), &none, fixture_home(), Language::Ko);
        assert_eq!(korean.title, "Notes: 저장");
        let none = save_options(&notes(), &none, fixture_home(), Language::En);
        assert_eq!(none.title, "Notes: Save");
        assert!(none.directory.is_none() && none.file_name.is_none() && none.filters.is_empty());
    }

    #[test]
    fn no_window_is_unsupported_and_a_dialog_that_did_not_open_failed() {
        assert!(matches!(
            not_shown(NotShown::NoWindow),
            DialogError::Unsupported(_)
        ));
        assert!(matches!(
            not_shown(NotShown::DidNotOpen),
            DialogError::Failed(_)
        ));
    }

    #[test]
    fn home_paths_are_the_home_folder() {
        let home = fixture_home();
        assert_eq!(local("~", home), fixture_home());
        assert_eq!(local("${home}/Notes", home), fixture_home().join("Notes"));
        assert_eq!(local("/tmp/x", home), PathBuf::from("/tmp/x"));
        assert_eq!(local("~other/x", home), PathBuf::from("~other/x"));
    }
}
