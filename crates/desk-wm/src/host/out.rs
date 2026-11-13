//! The windows out of the canvas in the plan (#235, ADR 0205): each in an OS window of its own,
//! drawn by nobody here, its plugins in sight for the live budget and seated at its OS window's
//! size (`Plan::seat`), whatever desktop is in front.

use crate::desk::Desk;
use crate::types::Rect;

use super::Plan;

/// A window out of the canvas, in an OS window of its own (#235).
#[derive(Clone, Debug, PartialEq)]
pub struct OutWindow {
    pub id: String,
    /// The desktop it docks back to.
    pub desktop: String,
    /// Its OS window's frame, in points of the OS's desktop.
    pub frame: Rect,
    /// The plugins it shows, first pane first.
    pub plugins: Vec<String>,
    /// Its title: its first plugin's, else its id.
    pub title: String,
    /// The window in use.
    pub focused: bool,
}

impl Plan {
    /// The window out of the canvas that shows plugin `plugin`, if one does.
    pub fn out_of(&self, plugin: &str) -> Option<&OutWindow> {
        (self.out.iter()).find(|w| w.plugins.iter().any(|p| p == plugin))
    }
}

impl Desk {
    /// The windows out of the canvas as the plan lists them.
    pub(super) fn out_plan(&self) -> Vec<OutWindow> {
        (self.out_windows().into_iter())
            .filter_map(|(desktop, p)| {
                let plugins = self.plugins_of(&p);
                let title = (plugins.first())
                    .and_then(|id| self.adopted.iter().find(|a| &a.id == id))
                    .map_or_else(|| p.id.clone(), |a| a.title.clone());
                Some(OutWindow {
                    focused: self.focused.as_deref() == Some(p.id.as_str()),
                    id: p.id,
                    desktop,
                    frame: p.out?,
                    plugins,
                    title,
                })
            })
            .collect()
    }
}
