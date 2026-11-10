//! Which plugins a window shows and a layout places (`placedPlugins` in
//! `packages/runtime/src/surface/placed.ts`, `resolveView` in `surface/views.ts`). The plugins the
//! windows of the desktop in front place wake (ADR 0070): a plugin that started asleep has no
//! surface until its first use, and a window showing nothing but plugins the runtime does not hold
//! is not drawn. Waking them as the layout changes is the host's (#81); this says which.

use crate::types::Placement;

/// The prefix of a view that shows a plugin's surface: `"plugin:endue.mail"`.
pub const PLUGIN_VIEW: &str = "plugin:";

/// The view a pane shows. A pane named after its window whose plugin the runtime handed over
/// (`adopted`) shows that plugin's surface, so a profile that places `endue.calendar` gets the
/// plugin, not a sample.
pub fn resolve_view(p: &Placement, view: &str, adopted: impl Fn(&str) -> bool) -> String {
    if view == p.id && adopted(&p.plugin) {
        format!("{PLUGIN_VIEW}{}", p.plugin)
    } else {
        view.to_string()
    }
}

/// The plugins `p`'s panes show, first pane first (a plugin in two panes, twice).
pub fn shown_plugins(p: &Placement, adopted: impl Fn(&str) -> bool) -> Vec<String> {
    p.panes()
        .leaves()
        .into_iter()
        .filter_map(|(_, view)| {
            resolve_view(p, view, &adopted)
                .strip_prefix(PLUGIN_VIEW)
                .map(String::from)
        })
        .collect()
}

/// The plugins a desktop's layout places, each once, in order: each window's own plugin, then those
/// its panes name.
pub fn placed_plugins(layout: &[Placement]) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for p in layout {
        let panes = p.panes();
        let named = panes
            .leaves()
            .into_iter()
            .filter_map(|(_, view)| view.strip_prefix(PLUGIN_VIEW));
        for id in std::iter::once(p.plugin.as_str()).chain(named) {
            if !ids.iter().any(|known| known == id) {
                ids.push(id.to_string());
            }
        }
    }
    ids
}
