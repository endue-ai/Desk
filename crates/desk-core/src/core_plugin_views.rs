//! The view plugins' views (ADR 0032), beside the person's files in `core_views`. An enabled,
//! ready plugin of kind `view` provides its inline `view` and its `views` files, read through the
//! registry (the folder check `desk-plugin://` uses, never a grant) when it is installed, turned on
//! or reloaded, and kept until its next change. They pass the same checks as the person's files,
//! but a file's name need not match its id; one that fails is left out and reported, and the
//! plugin stays ready. An id goes to the first plugin in `plugin.list` order that provides it, and
//! a person's file of the id shadows them all. After a plugin changes, each id whose view.get
//! answer it touched is a `view.changed`.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::MutexGuard;

use desk_bridge::{PluginInfo, PluginKind, PluginStatus, View, ViewChange};

use crate::core_views::{check_view, parse_view, shown};
use crate::handler::Core;

/// What each view plugin provides, by plugin id, as last read.
#[derive(Default)]
pub(crate) struct ProvidedViews(BTreeMap<String, Provided>);

/// One plugin's views: the valid ones in manifest order, each with where it is (`plugin.json` or
/// its file), and what is wrong with the others.
#[derive(Default)]
struct Provided {
    views: Vec<(String, View)>,
    problems: Vec<String>,
}

/// The plugin views that count, by view id: the plugin that provides it, and the view.
pub(crate) type PluginViews = BTreeMap<String, (String, View)>;

impl Core {
    /// Read again the views of the plugin `info` describes, then announce each id whose view.get
    /// answer changed with it: `saved` for the ids it provides now, and for those it stopped
    /// providing, `saved` when another plugin takes one over and `removed` otherwise. Ids a
    /// person's file shadows are left alone.
    pub(crate) fn plugin_views_changed(&self, info: &PluginInfo) {
        let before = self.plugin_views();
        let provided = self.read_plugin_views(info);
        self.provided().0.insert(info.id.clone(), provided);
        let after = self.plugin_views();
        let owner = |views: &PluginViews, id: &str| views.get(id).map(|(plugin, _)| plugin.clone());
        let mut changes = Vec::new();
        let ids: BTreeSet<&String> = before.keys().chain(after.keys()).collect();
        for id in ids {
            let now = owner(&after, id);
            let change = if now.as_ref() == Some(&info.id) {
                ViewChange::Saved
            } else if owner(&before, id).as_ref() == Some(&info.id) {
                shown(now.is_some())
            } else {
                continue;
            };
            changes.push((id.clone(), change));
        }
        if changes.is_empty() {
            return;
        }
        let shadowed: BTreeSet<String> = self.view_files().into_iter().map(|(id, _)| id).collect();
        for (id, change) in changes {
            if !shadowed.contains(&id) {
                self.view_changed(&id, change);
            }
        }
    }

    /// The plugin views that count now, by id.
    pub(crate) fn plugin_views(&self) -> PluginViews {
        self.resolve_plugin_views().0
    }

    /// The plugin view of `id` that counts, with its plugin.
    pub(crate) fn plugin_view(&self, id: &str) -> Option<(String, View)> {
        self.plugin_views().remove(id)
    }

    /// What is wrong with the view plugins' views, in `plugin.list` order, then the views left
    /// out because an earlier plugin (or an earlier file of the same one) has their id.
    pub(crate) fn plugin_view_problems(&self) -> Vec<String> {
        let order = self.plugin_order();
        let mut problems: Vec<String> = {
            let provided = self.provided();
            let of = |plugin: &String| provided.0.get(plugin).map(|p| p.problems.clone());
            order.iter().filter_map(of).flatten().collect()
        };
        problems.extend(self.resolve_plugin_views().1);
        problems
    }

    /// The views that count, by id, and the problems of those left out for an id already taken.
    fn resolve_plugin_views(&self) -> (PluginViews, Vec<String>) {
        let order = self.plugin_order();
        let provided = self.provided();
        let mut views = PluginViews::new();
        let mut taken = Vec::new();
        for plugin in order {
            let Some(provided) = provided.0.get(&plugin) else {
                continue;
            };
            for (place, view) in &provided.views {
                if let Some((first, _)) = views.get(&view.id) {
                    let id = &view.id;
                    taken.push(format!(
                        "{plugin}: {place}: view {id} is left out: plugin {first} provides it first"
                    ));
                } else {
                    views.insert(view.id.clone(), (plugin.clone(), view.clone()));
                }
            }
        }
        (views, taken)
    }

    /// The views the plugin provides as it is now: none unless it is an enabled, ready view
    /// plugin. Each problem starts with the plugin id, then the file (`plugin.json` for the inline
    /// view) and where in it.
    fn read_plugin_views(&self, info: &PluginInfo) -> Provided {
        let mut provided = Provided::default();
        let counts = info.enabled && info.status == PluginStatus::Ready;
        let manifest = info
            .manifest
            .as_ref()
            .filter(|m| m.kind == PluginKind::View);
        let Some(manifest) = manifest.filter(|_| counts) else {
            return provided;
        };
        let mut found = Vec::new();
        if let Some(view) = &manifest.view {
            let value = serde_json::to_value(view).unwrap_or_default();
            found.push((
                "plugin.json".to_owned(),
                check_view("plugin.json/view", value),
            ));
        }
        for path in manifest.views.iter().flatten() {
            let checked = match self.plugin_file(&info.id, path) {
                Ok(bytes) => parse_view(path, bytes, path.ends_with(".json")).map(|(v, _)| v),
                Err(e) => Err(format!("{path}: cannot be read: {e}")),
            };
            found.push((path.clone(), checked));
        }
        for (place, checked) in found {
            match checked {
                Ok(view) => provided.views.push((place, view)),
                Err(problem) => provided.problems.push(format!("{}: {problem}", info.id)),
            }
        }
        provided
    }

    /// The installed plugins' ids in `plugin.list` order.
    fn plugin_order(&self) -> Vec<String> {
        self.plugins().into_iter().map(|info| info.id).collect()
    }

    fn provided(&self) -> MutexGuard<'_, ProvidedViews> {
        self.provided_views
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
