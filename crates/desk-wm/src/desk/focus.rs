//! The focus order and cycling (`desk.display.focus-next` and `focus-previous` in
//! `packages/runtime/src/policies/display.ts`, over the host's views of `shell/panes.ts` and the
//! runtime's surfaces in sight). A pane of the shell's own is a stop named `<window>/<pane>`; a
//! pane showing a plugin is that plugin's surface, a stop named by the plugin's id, counted once
//! (ADR 0040). Buffers name the same stops.

use crate::placed::PLUGIN_VIEW;

use super::Desk;

/// The stop `step` places from `focused` in `order`, wrapping around: from none, `step` counts
/// from just before the first (`ids[(at + step + n) % n]` with `at` = -1, as the runtime counts).
pub fn cycle<'a>(order: &'a [String], focused: Option<&str>, step: i64) -> Option<&'a String> {
    let n = order.len() as i64;
    if n == 0 {
        return None;
    }
    let at = focused
        .and_then(|id| order.iter().position(|o| o == id))
        .map_or(-1, |i| i as i64);
    let i = usize::try_from((at + step + n).rem_euclid(n)).unwrap_or(0);
    order.get(i)
}

impl Desk {
    /// The panes of the shell's own on the desktop in front, in reading order (`paneViews`):
    /// `<window>/<pane>`, those showing a plugin's surface left out.
    pub fn pane_views(&self) -> Vec<String> {
        self.windows()
            .into_iter()
            .flat_map(|p| {
                p.panes()
                    .leaves()
                    .into_iter()
                    .filter(|(_, view)| !self.resolve(&p, view).starts_with(PLUGIN_VIEW))
                    .map(|(pane, _)| format!("{}/{pane}", p.id))
                    .collect::<Vec<_>>()
            })
            .collect()
    }

    /// Every stop the focus cycles through: the panes of the shell's own, then the plugin
    /// surfaces the desktop in front shows, in the order the runtime mounted them.
    pub fn focus_order(&self) -> Vec<String> {
        let shown: Vec<String> = self
            .windows()
            .iter()
            .flat_map(|p| self.plugins_of(p))
            .collect();
        let mut order = self.pane_views();
        order.extend(
            self.adopted
                .iter()
                .filter(|a| shown.contains(&a.id))
                .map(|a| a.id.clone()),
        );
        order
    }

    /// The stop in use: the plugin surface in use, else the pane of the shell's own in use.
    pub fn focused_id(&self) -> Option<String> {
        if let Some(plugin) = self.focused_plugin() {
            return Some(plugin);
        }
        let window = self.focused_window()?;
        let p = self.window(&window)?;
        let tree = p.panes();
        let leaves = tree.leaves();
        let pane = self
            .pane
            .as_deref()
            .or_else(|| leaves.first().map(|(id, _)| *id))?;
        let id = format!("{window}/{pane}");
        self.pane_views().contains(&id).then_some(id)
    }

    /// Give a stop the focus: a pane of the shell's own on the desktop in front, or a plugin
    /// surface wherever its window is (`show_plugin`). Anything else changes nothing.
    pub fn focus(&mut self, id: &str) {
        if self.pane_views().iter().any(|v| v == id) {
            if let Some((window, pane)) = id.rsplit_once('/') {
                self.focus_pane(window, Some(pane));
            }
        } else if self.holds(id) {
            self.show_plugin(id);
        }
    }

    /// Focus the stop `step` places on (1 next, -1 previous), wrapping around; answers it.
    pub fn focus_next(&mut self, step: i64) -> Option<String> {
        let order = self.focus_order();
        let next = cycle(&order, self.focused_id().as_deref(), step)?.clone();
        self.focus(&next);
        Some(next)
    }
}
