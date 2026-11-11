//! `desk theme` (ADR 0058): the installed themes, the one in force, and the person's own themes as
//! `.desk-theme` files. `list` reads plugin.list (plugin:manage) and says where each theme comes
//! from, `apply` runs the runtime's `desk.theme.use` (cmd:invoke), and `import`, `export` and
//! `remove` call theme.* (theme:manage).

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use serde_json::{Map, Value, json};

use crate::args::ThemeStep;
use crate::remote::{Problem, Reply, Session, text};

impl Session {
    pub(crate) fn theme(&mut self, step: ThemeStep) -> Result<ExitCode, Problem> {
        let scope = json!({ "permission": "theme:manage" });
        match step {
            ThemeStep::List => {
                let params = json!({ "scope": { "permission": "plugin:manage" } });
                let reply = self.call("plugin.list", params)?;
                Ok(self.report(reply, |result| {
                    let plugins = result["plugins"].as_array();
                    plugins
                        .into_iter()
                        .flatten()
                        .filter_map(theme_line)
                        .collect()
                }))
            }
            ThemeStep::Apply(id) => self.apply(&id),
            ThemeStep::Import(file) => {
                let params = json!({ "path": absolute(&file)?, "scope": scope });
                let reply = self.call("theme.import", params)?;
                Ok(self.report(reply, |result| {
                    vec![text(&result["plugin"], "id").to_owned()]
                }))
            }
            ThemeStep::Export { id, file } => {
                let mut params = json!({ "theme": id, "scope": scope });
                if let Some(file) = file {
                    params["path"] = json!(absolute(&file)?);
                }
                let reply = self.call("theme.export", params)?;
                Ok(self.report(reply, |result| vec![text(result, "path").to_owned()]))
            }
            ThemeStep::Remove(id) => {
                self.done("theme.remove", json!({ "theme": id, "scope": scope }))
            }
        }
    }

    /// `desk.theme.use { id }`, which answers the theme now in force: anything but `id` means the
    /// desk has no such theme.
    fn apply(&mut self, id: &str) -> Result<ExitCode, Problem> {
        let mut args = Map::new();
        args.insert("id".to_owned(), json!(id));
        let Reply { result, line } = self.invoke_and_wait("desk.theme.use", Some(args))?;
        let result = match result {
            Ok(active) if active == id => Ok(active),
            Ok(_) => Err(("not_found".to_owned(), format!("no installed theme {id}"))),
            Err(failure) => Err(failure),
        };
        Ok(self.report(Reply { result, line }, |_| vec!["ok".to_owned()]))
    }
}

/// `id  status  source  name` for a theme or design system, and for a failed plugin in the user
/// themes folder, which has no kind to show.
fn theme_line(plugin: &Value) -> Option<String> {
    let source = source(plugin);
    let kind = &plugin["manifest"]["kind"];
    let theme = kind == "theme"
        || kind == "design-system"
        || (plugin["status"] == "failed" && source == "user");
    let name = plugin["manifest"]["name"].as_str().unwrap_or("-");
    let (id, status) = (text(plugin, "id"), text(plugin, "status"));
    theme.then(|| format!("{id}\t{status}\t{source}\t{name}"))
}

/// Where an installed plugin comes from, by its folder: `built-in`; `user`, a folder in the user
/// themes folder (`<data>/themes`, which theme.import and the market write and theme.remove
/// deletes from); `pack`, a pack's nested plugin (`<pack>/plugins/<folder>`); otherwise `dev`, a
/// folder the desk was started with (`DESK_DEV_PLUGINS`).
fn source(plugin: &Value) -> &'static str {
    if plugin["builtIn"] == true {
        return "built-in";
    }
    let folder = Path::new(text(plugin, "folder"));
    match folder.parent().and_then(Path::file_name) {
        Some(parent) if parent == "themes" => "user",
        Some(parent) if parent == "plugins" => "pack",
        _ => "dev",
    }
}

/// The bridge path of a file the person named: absolute, with forward slashes.
fn absolute(file: &Path) -> Result<String, Problem> {
    let path: PathBuf = std::path::absolute(file).map_err(Problem::Io)?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}
