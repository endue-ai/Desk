//! Core-authenticated provenance for passing a file choice to the desk's rule-selected opener.

use std::cell::Cell;

use desk_bridge::{FsReadPermission, FsWritePermission, Permission};
use serde_json::{Map, Value};

use crate::handler::Core;
use crate::paths::normalize;

thread_local! {
    /// Set on the conversation's own worker from the caller of brain.say, before tools can run.
    pub(crate) static PERSON_TURN: Cell<bool> = const { Cell::new(false) };
}

impl Core {
    pub(crate) fn trusted_builtin(&self, caller: &str, expected: &str) -> bool {
        caller == expected
            && self
                .registry()
                .get(caller)
                .is_some_and(|info| info.built_in && info.enabled)
    }

    pub(crate) fn file_open_granted(
        &self,
        caller: &str,
        id: &str,
        provider: &str,
        args: Option<&Map<String, Value>>,
    ) -> Option<bool> {
        if id != "desk.files.open" || provider != "desk" {
            return None;
        }
        let args = args?;
        if args.contains_key("plugin") || args.get("grant").and_then(Value::as_bool) == Some(false)
        {
            return None;
        }
        let selected = self.trusted_builtin(caller, "endue.explorer")
            || (caller == "agent:eris" && PERSON_TURN.get());
        if !selected {
            return None;
        }
        let path = literal_path(args.get("path")?.as_str()?)?;
        let scope = read_scope(vec![path]);
        self.has_lasting_file_access(caller, &scope).then_some(true)
    }

    fn has_lasting_file_access(&self, caller: &str, scope: &Permission) -> bool {
        self.capped(caller, scope).is_none() && self.lasting_grant(caller, scope).is_some()
    }

    /// Grant the paths of a physical drop the host delivered. A plugin source can pass along
    /// only its own readable paths. An absent source means the host received them from the OS.
    pub fn grant_file_drop<'a>(
        &self,
        source: Option<&str>,
        target: &str,
        paths: impl IntoIterator<Item = &'a str>,
        destination: Option<&str>,
    ) {
        if !self
            .registry()
            .get(target)
            .is_some_and(|plugin| plugin.enabled)
        {
            return;
        }
        let paths: Vec<String> = paths
            .into_iter()
            .take(10_000)
            .filter_map(literal_path)
            .filter(|path| {
                source.is_none_or(|source| {
                    self.has_lasting_file_access(source, &read_scope(vec![path.clone()]))
                })
            })
            .collect();
        if paths.is_empty() {
            return;
        }
        if self.trusted_builtin(target, "endue.explorer")
            && let Some(folder) = destination.and_then(literal_path)
            && self.has_lasting_file_access(target, &read_scope(vec![folder.clone()]))
            && self.resolve(&folder).is_ok_and(|path| path.is_dir())
        {
            let under = format!("{}/**", folder.trim_end_matches('/'));
            self.grant_chosen(
                target,
                Permission::FsWrite(FsWritePermission {
                    permission: Default::default(),
                    paths: vec![folder, under],
                }),
            );
        }
        self.grant_chosen(target, read_scope(paths));
    }
}

fn read_scope(paths: Vec<String>) -> Permission {
    Permission::FsRead(FsReadPermission {
        permission: Default::default(),
        paths,
    })
}

fn literal_path(path: &str) -> Option<String> {
    if path.contains(['*', '?', '\0', '\\']) || path.starts_with("//") {
        return None;
    }
    let normalized = normalize(path)?;
    let rooted = normalized.starts_with('/')
        || normalized.starts_with('~')
        || normalized.as_bytes().get(1) == Some(&b':');
    rooted.then_some(normalized)
}
