//! The file dialog (`rfd`, as `tauri-plugin-dialog` was): `plugin:dialog|open` with the options
//! `@tauri-apps/plugin-dialog`'s `open()` sends, so `pickNativeFile` (`apps/desk/src/native-files.ts`)
//! calls both shells alike. The dialog starts on the event loop's thread, as a sheet on the main
//! window, and the bridge call waits for the person's choice on its own thread; the loop keeps
//! running (and CEF keeps pumping) meanwhile. The answer is `null`, one path, or a list of paths.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::sync::mpsc;
use std::time::Duration;

use desk_web::sender::Role;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::host::Desk;

/// What `open()` asks for (`OpenDialogOptions`, camelCase).
#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub multiple: bool,
    pub directory: bool,
    pub title: Option<String>,
    pub default_path: Option<String>,
    pub filters: Vec<Filter>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(default)]
pub struct Filter {
    pub name: String,
    pub extensions: Vec<String>,
}

/// The options of a call's `args` (`{ options }`); none at all are the defaults.
pub fn options(args: &Value) -> Result<Options, String> {
    match args.get("options") {
        None | Some(Value::Null) => Ok(Options::default()),
        Some(options) => serde_json::from_value(options.clone())
            .map_err(|why| format!("not dialog options: {why}")),
    }
}

/// What `open()` resolves to: `null` when the person cancelled, a path, or (with `multiple`) paths.
pub fn answer(picked: Option<Vec<PathBuf>>, multiple: bool) -> Value {
    let paths: Vec<String> = picked
        .unwrap_or_default()
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    match (multiple, paths.as_slice()) {
        (_, []) => Value::Null,
        (true, _) => json!(paths),
        (false, [first, ..]) => json!(first),
    }
}

type Picking = Pin<Box<dyn Future<Output = Option<Vec<PathBuf>>> + Send>>;

/// Show the dialog `args` asks for and wait for the person's choice.
pub fn open(desk: &Desk, args: &Value) -> Result<Value, String> {
    let options = options(args)?;
    let multiple = options.multiple;
    let (started, picking) = mpsc::channel::<Picking>();
    desk.pump.run(move |shell, _| {
        let parent = shell
            .pane(Role::Main)
            .map(|pane| std::sync::Arc::clone(&pane.window));
        let _ = started.send(start(options, parent.as_deref()));
    });
    let picking = picking
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "the file dialog did not open".to_owned())?;
    Ok(answer(pollster::block_on(picking), multiple))
}

/// Start the dialog `options` asks for, over `parent`. Call on the event loop's thread.
fn start(options: Options, parent: Option<&winit::window::Window>) -> Picking {
    let mut dialog = rfd::AsyncFileDialog::new();
    if let Some(parent) = parent {
        dialog = dialog.set_parent(parent);
    }
    if let Some(title) = &options.title {
        dialog = dialog.set_title(title);
    }
    if let Some(path) = &options.default_path {
        dialog = dialog.set_directory(path);
    }
    for filter in &options.filters {
        dialog = dialog.add_filter(&filter.name, &filter.extensions);
    }
    let paths =
        |handles: Vec<rfd::FileHandle>| handles.iter().map(|h| h.path().to_owned()).collect();
    match (options.directory, options.multiple) {
        (false, false) => {
            let picking = dialog.pick_file();
            Box::pin(async move { picking.await.map(|h| vec![h.path().to_owned()]) })
        }
        (false, true) => {
            let picking = dialog.pick_files();
            Box::pin(async move { picking.await.map(paths) })
        }
        (true, false) => {
            let picking = dialog.pick_folder();
            Box::pin(async move { picking.await.map(|h| vec![h.path().to_owned()]) })
        }
        (true, true) => {
            let picking = dialog.pick_folders();
            Box::pin(async move { picking.await.map(paths) })
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::{Value, json};

    use super::{Filter, Options, answer, options};

    #[test]
    fn the_options_are_the_tauri_dialogs() {
        assert_eq!(options(&json!({})).unwrap(), Options::default());
        assert_eq!(
            options(&json!({ "options": null })).unwrap(),
            Options::default()
        );
        let picked = options(&json!({ "options": {
            "multiple": false, "directory": false, "title": "Open",
            "defaultPath": "/Users/person", "filters": [{ "name": "Markdown", "extensions": ["md"] }],
        }}))
        .unwrap();
        assert_eq!(picked.title.as_deref(), Some("Open"));
        assert_eq!(picked.default_path.as_deref(), Some("/Users/person"));
        assert_eq!(
            picked.filters,
            [Filter {
                name: "Markdown".into(),
                extensions: vec!["md".into()]
            }]
        );
        assert!(options(&json!({ "options": { "multiple": "yes" } })).is_err());
    }

    #[test]
    fn the_answer_is_null_a_path_or_paths() {
        let two = Some(vec![PathBuf::from("/a.md"), PathBuf::from("/b 한.md")]);
        assert_eq!(answer(None, false), Value::Null);
        assert_eq!(answer(Some(Vec::new()), true), Value::Null);
        assert_eq!(answer(two.clone(), false), json!("/a.md"));
        assert_eq!(answer(two, true), json!(["/a.md", "/b 한.md"]));
    }
}
