//! The tabs of a window (ADR 0270): add one, close one, show another view in one. Pure functions
//! over a window's `Tab`s (`types.rs`), so a layout stays JSON. A window shows one tab at a time,
//! under a strip of its tabs once it has more than one (`host/tabs.rs`).
//!
//! A window takes only tabs of its own kind: a plugin's window, further windows of that plugin
//! (ADR 0212), and no other window any. `kind_of` names a view's kind; the desk checks it
//! (`Desk::add_tab`).

use crate::placed::PLUGIN_VIEW;
use crate::types::Tab;
use crate::window_key::plugin_of;

/// What a new window's first tab shows: the launcher, to pick a view.
pub const LAUNCHER: &str = "launcher";

/// The tab `id` among `tabs`.
pub fn find<'a>(tabs: &'a [Tab], id: &str) -> Option<&'a Tab> {
    tabs.iter().find(|t| t.id == id)
}

/// The plugin a view's window belongs to: `endue.terminal` for `plugin:endue.terminal@2`. None for
/// a view of the shell's own, which is no plugin's window.
pub fn kind_of(view: &str) -> Option<&str> {
    view.strip_prefix(PLUGIN_VIEW).map(plugin_of)
}

/// The next free tab id: `p1`, `p2`, ..., one past every number a tab already has, so an id is
/// never reused while its window stays.
pub fn next_id(tabs: &[Tab]) -> String {
    let highest = tabs
        .iter()
        .filter_map(|t| {
            let digits = t.id.strip_prefix('p')?;
            let all_digits = !digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit());
            all_digits.then(|| digits.parse::<u64>().unwrap_or(u64::MAX - 1))
        })
        .max()
        .unwrap_or(0);
    format!("p{}", highest + 1)
}

/// `tabs` with a new one showing `view` right after tab `after` (at the end when it has none
/// such). Answers the tabs and the new tab's id.
pub fn add(tabs: &[Tab], after: &str, view: &str) -> (Vec<Tab>, String) {
    let added = next_id(tabs);
    let at = (tabs.iter().position(|t| t.id == after)).map_or(tabs.len(), |i| i + 1);
    let mut next = tabs.to_vec();
    next.insert(at, Tab::new(added.clone(), view));
    (next, added)
}

/// `tabs` without tab `id`, and the tab to show in its place: the one that followed it, else the
/// one before. `None` when it was the last tab, or `tabs` has none such.
pub fn close(tabs: &[Tab], id: &str) -> Option<(Vec<Tab>, String)> {
    let at = tabs.iter().position(|t| t.id == id)?;
    let mut next = tabs.to_vec();
    next.remove(at);
    let beside = next.get(at).or(next.last())?.id.clone();
    Some((next, beside))
}

/// Tab `id` showing `view`.
pub fn set_view(tabs: &[Tab], id: &str, view: &str) -> Vec<Tab> {
    tabs.iter()
        .map(|t| {
            if t.id == id {
                Tab::new(t.id.clone(), view)
            } else {
                t.clone()
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tabs(ids: &[&str]) -> Vec<Tab> {
        ids.iter().map(|id| Tab::new(*id, "launcher")).collect()
    }

    #[test]
    fn a_new_tab_goes_right_after_the_one_named_and_takes_the_next_number() {
        let (next, added) = add(&tabs(&["p1", "p4", "p2"]), "p1", "plugin:a.b@2");
        assert_eq!(added, "p5");
        let ids: Vec<&str> = next.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, ["p1", "p5", "p4", "p2"]);
        assert_eq!(next[1].view, "plugin:a.b@2");
        // One named after no tab goes last.
        assert_eq!(add(&tabs(&["p1"]), "p9", "launcher").0[1].id, "p2");
    }

    #[test]
    fn closing_a_tab_shows_the_one_after_it_else_the_one_before() {
        let all = tabs(&["p1", "p2", "p3"]);
        let show = |id: &str| close(&all, id).map(|(_, show)| show);
        assert_eq!(show("p2").as_deref(), Some("p3"));
        assert_eq!(show("p3").as_deref(), Some("p2"));
        assert_eq!(close(&tabs(&["p1"]), "p1"), None);
        assert_eq!(close(&all, "p9"), None);
    }

    #[test]
    fn a_views_kind_is_its_plugin_whichever_window_of_it() {
        assert_eq!(kind_of("plugin:endue.terminal"), Some("endue.terminal"));
        assert_eq!(kind_of("plugin:endue.terminal@3"), Some("endue.terminal"));
        assert_eq!(kind_of("launcher"), None);
        assert_eq!(kind_of("agent:ana"), None);
    }
}
