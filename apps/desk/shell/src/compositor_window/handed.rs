//! The runtime's windows whose plugin shows in an OS window of its own (#234, `app_windows.rs`):
//! the compositor draws nothing for them (`Hosted::plan`), and the person's close of the OS window
//! closes the runtime's window, which this finds.

use super::CompositorWindow;

impl CompositorWindow {
    /// The runtime's window that shows plugin `plugin`, on any desktop.
    pub fn window_holding(&self, plugin: &str) -> Option<String> {
        let desk = self.hosted.wm.desk();
        (desk.desktops().iter())
            .flat_map(|d| desk.windows_of(&d.id))
            .find(|p| desk.plugins_of(p).iter().any(|id| id == plugin))
            .map(|p| p.id)
    }
}
