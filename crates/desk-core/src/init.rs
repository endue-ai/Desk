//! init.yaml: a person's own setup, read at every start the way Emacs reads init.el. The format is
//! `specs/init/v0`: the YAML is parsed, checked against the spec's schema and read into the generated
//! `InitDocument`. The file is theirs to edit. The core writes the template when there is none, and
//! otherwise replaces the file only when sync pulls a newer copy from endue.

use std::collections::BTreeMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use desk_bridge::InitDocument;
use serde_json::{Value, json};

use crate::manifest::schema_registry;

/// The init.yaml format this core reads.
pub const INIT_VERSION: u64 = 0;

/// A new init.yaml: the defaults, with a comment on every key (`specs/init/v0/init.template.yaml`).
pub const INIT_TEMPLATE: &str = include_str!("../../../specs/init/v0/init.template.yaml");

const INIT_SCHEMA_ID: &str = "https://endue.ai/specs/init/v0/init.schema.json";

/// The setup init.yaml describes, with every key it leaves out at its default.
#[derive(Debug, Clone, PartialEq)]
pub struct Init {
    pub version: u64,
    pub mode: String,
    pub plugins: PluginSetup,
    pub settings: BTreeMap<String, Value>,
    pub sync: SyncSetup,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct PluginSetup {
    /// Plugin ids that start disabled.
    pub disabled: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct SyncSetup {
    /// Sync init.yaml through endue.
    pub enabled: bool,
}

impl Default for Init {
    fn default() -> Self {
        Self::from(InitDocument {
            version: None,
            mode: None,
            plugins: None,
            settings: None,
            sync: None,
        })
    }
}

impl From<InitDocument> for Init {
    fn from(document: InitDocument) -> Self {
        Self {
            version: document.version.unwrap_or(INIT_VERSION),
            mode: document.mode.unwrap_or_else(|| "default".to_owned()),
            plugins: PluginSetup {
                disabled: document
                    .plugins
                    .and_then(|plugins| plugins.disabled)
                    .unwrap_or_default(),
            },
            settings: document.settings.unwrap_or_default(),
            sync: SyncSetup {
                enabled: document.sync.and_then(|sync| sync.enabled).unwrap_or(false),
            },
        }
    }
}

impl Init {
    /// Parse init.yaml and check it against `specs/init/v0`. An empty file, or one with only
    /// comments, is the defaults. Problems name where they are, for example `init.yaml/mode: ...`.
    pub fn parse(text: &str) -> Result<Self, String> {
        let value = yaml_serde::from_str::<Option<Value>>(text)
            .map_err(|e| e.to_string())?
            .filter(|value| !value.is_null())
            .unwrap_or_else(|| json!({}));
        if let Some(version) = value.get("version").and_then(Value::as_u64)
            && version > INIT_VERSION
        {
            return Err(format!(
                "version {version} is newer than this Desk reads ({INIT_VERSION}); update Desk"
            ));
        }
        let problems: Vec<String> = validator()
            .iter_errors(&value)
            .map(|error| format!("init.yaml{}: {error}", error.instance_path()))
            .collect();
        if !problems.is_empty() {
            return Err(problems.join("; "));
        }
        serde_json::from_value::<InitDocument>(value)
            .map(Self::from)
            .map_err(|e| format!("init.yaml: does not match the init type: {e}"))
    }

    pub fn setting(&self, key: &str) -> Option<&Value> {
        self.settings.get(key)
    }

    /// Whether this setup says nothing of its own beyond turning sync on: a desk with such a file has
    /// nothing to lose by taking the copy on endue.
    pub fn is_default(&self) -> bool {
        Self {
            sync: SyncSetup::default(),
            ..self.clone()
        } == Self::default()
    }
}

fn validator() -> &'static jsonschema::Validator {
    static VALIDATOR: OnceLock<jsonschema::Validator> = OnceLock::new();
    VALIDATOR.get_or_init(|| {
        jsonschema::options()
            .with_registry(schema_registry())
            .should_validate_formats(false)
            .build(&json!({ "$ref": INIT_SCHEMA_ID }))
            .expect("the init schema compiles")
    })
}

/// init.yaml on disk, or in memory only, and the setup in force.
#[derive(Debug)]
pub struct InitFile {
    path: Option<PathBuf>,
    /// The text when there is no file.
    text: String,
    init: Init,
    problem: Option<String>,
}

impl InitFile {
    /// The template, in memory only.
    pub fn memory() -> Self {
        Self {
            path: None,
            text: INIT_TEMPLATE.to_owned(),
            init: Init::default(),
            problem: None,
        }
    }

    /// Read `path`, writing the template there first when there is no file.
    pub fn open(path: PathBuf) -> Self {
        let mut file = Self {
            path: Some(path),
            ..Self::memory()
        };
        if let Some(path) = file.path.as_deref().filter(|p| !p.exists())
            && let Err(e) = write_atomic(path, INIT_TEMPLATE)
        {
            file.problem = Some(format!("cannot write {}: {e}", path.display()));
        }
        file.reload();
        file
    }

    /// The setup in force: the file as last read, or the last setup that parsed.
    pub fn init(&self) -> &Init {
        &self.init
    }

    /// Why the file is not in force, when it does not parse or cannot be read.
    pub fn problem(&self) -> Option<&str> {
        self.problem.as_deref()
    }

    /// The text as it is now.
    pub fn read(&self) -> io::Result<String> {
        match &self.path {
            Some(path) => fs::read_to_string(path),
            None => Ok(self.text.clone()),
        }
    }

    /// Read the file again. When it does not parse, the setup in force stays and `problem` says why.
    pub fn reload(&mut self) {
        match self.read() {
            Ok(text) => self.apply(&text),
            Err(e) => self.problem = Some(e.to_string()),
        }
    }

    /// Replace the text with `text` if it still is `expected`. `Ok(false)` when it changed meanwhile
    /// (the person saved an edit); nothing is written then.
    pub fn replace(&mut self, expected: &str, text: &str) -> io::Result<bool> {
        if self.read()? != expected {
            return Ok(false);
        }
        match &self.path {
            Some(path) => write_atomic(path, text)?,
            None => self.text = text.to_owned(),
        }
        self.apply(text);
        Ok(true)
    }

    /// Keep endue's copy next to init.yaml (`init.remote.yaml`) for the person to merge.
    pub fn save_remote_copy(&self, text: &str) -> io::Result<()> {
        match self.remote_copy_path() {
            Some(path) => write_atomic(&path, text),
            None => Ok(()),
        }
    }

    pub fn drop_remote_copy(&self) {
        if let Some(path) = self.remote_copy_path() {
            let _ = fs::remove_file(path);
        }
    }

    pub fn remote_copy_path(&self) -> Option<PathBuf> {
        let path = self.path.as_deref()?;
        let stem = path.file_stem()?.to_string_lossy();
        Some(path.with_file_name(format!("{stem}.remote.yaml")))
    }

    fn apply(&mut self, text: &str) {
        match Init::parse(text) {
            Ok(init) => {
                self.init = init;
                self.problem = None;
            }
            Err(why) => self.problem = Some(why),
        }
    }
}

/// Write through a temporary file, so a crash never leaves half a file behind.
fn write_atomic(path: &Path, text: &str) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    fs::write(&temporary, text)?;
    fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_template_is_the_defaults() {
        assert_eq!(Init::parse(INIT_TEMPLATE), Ok(Init::default()));
        assert_eq!(Init::parse(""), Ok(Init::default()));
        assert_eq!(Init::parse("# only a comment\n"), Ok(Init::default()));
    }

    #[test]
    fn reads_keys_and_leaves_the_rest_at_their_defaults() {
        let init = Init::parse(
            "mode: focus\nplugins: { disabled: [endue.sidebar] }\nsettings:\n  eris.voice: true\n",
        )
        .unwrap();
        assert_eq!(init.mode, "focus");
        assert_eq!(init.plugins.disabled, ["endue.sidebar"]);
        assert_eq!(init.setting("eris.voice"), Some(&json!(true)));
        assert!(!init.sync.enabled);
    }

    #[test]
    fn refuses_files_it_cannot_read() {
        assert!(Init::parse("version: 1\n").unwrap_err().contains("newer"));
        assert!(Init::parse("mode: [\n").unwrap_err().contains("line"));
        assert!(Init::parse("- mode\n").is_err());
    }

    #[test]
    fn refuses_what_the_spec_refuses_and_says_where() {
        let unknown = Init::parse("mode: focus\ntheme: dark\n").unwrap_err();
        assert!(unknown.contains("theme"), "{unknown}");
        let id = Init::parse("plugins: { disabled: [Sidebar] }\n").unwrap_err();
        assert!(id.starts_with("init.yaml/plugins/disabled/0: "), "{id}");
        let flag = Init::parse("sync: { enabled: yes }\n").unwrap_err();
        assert!(flag.starts_with("init.yaml/sync/enabled: "), "{flag}");
    }

    #[test]
    fn turning_sync_on_keeps_a_setup_default() {
        assert!(
            Init::parse("sync: { enabled: true }\n")
                .unwrap()
                .is_default()
        );
        assert!(!Init::parse("mode: focus\n").unwrap().is_default());
    }

    #[test]
    fn names_the_remote_copy_after_the_file() {
        let file = InitFile {
            path: Some(PathBuf::from("/x/init.yaml")),
            ..InitFile::memory()
        };
        assert_eq!(
            file.remote_copy_path(),
            Some(PathBuf::from("/x/init.remote.yaml"))
        );
        assert_eq!(InitFile::memory().remote_copy_path(), None);
    }
}
