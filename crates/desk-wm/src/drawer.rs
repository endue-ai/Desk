//! The drawer's items (`DrawerItem` in `packages/runtime/src/shell/state.ts`, ages in
//! `shell/Drawer.ts`): windows put away, dropped files, and Eris's temporary screens ("recent"),
//! which start fading after 12 hours and are gone after 24. Times are wall-clock milliseconds,
//! kept across a relaunch; the caller passes the time now, so nothing here reads a clock.
//!
//! What the drawer holds against the desktops (never a window a desktop places, #4) is the
//! `Desk`'s rule (`desk/drawer.rs`).

use serde::{Deserialize, Serialize};

use crate::types::Placement;

/// An hour in milliseconds.
pub const HOUR: i64 = 3_600_000;
/// A recent item starts fading this old.
pub const FADES_AFTER: i64 = 12 * HOUR;
/// A recent item this old is not shown any more.
pub const GONE_AFTER: i64 = 24 * HOUR;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DrawerKind {
    /// A window put away; `placement` is where it comes back.
    Surface,
    /// A file dropped on the drawer.
    File,
    /// One of Eris's temporary screens.
    Recent,
}

/// One thing in the drawer, with the wall-clock time it went in (`at`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DrawerItem {
    pub id: String,
    pub kind: DrawerKind,
    pub name: String,
    pub at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placement: Option<Placement>,
}

impl DrawerItem {
    /// The window it opens when it comes back: a put-away window's own id, a recent item's screen
    /// (`recent:<id>`) or a file's view (`file:<name>`).
    pub fn window(&self) -> String {
        match (&self.placement, self.kind) {
            (Some(p), _) => p.id.clone(),
            (None, DrawerKind::Recent) => format!("recent:{}", self.id),
            (None, _) => format!("file:{}", self.name),
        }
    }

    /// How old it is at `now`, in whole hours, for "3 h ago".
    pub fn hours_old(&self, now: i64) -> i64 {
        (now - self.at).div_euclid(HOUR)
    }
}

/// How opaque a recent item `age` milliseconds old is drawn: whole until 12 h, then fading to
/// nothing at 24 h.
pub fn recent_fade(age: i64) -> f64 {
    (1.0 - (age - FADES_AFTER) as f64 / FADES_AFTER as f64).clamp(0.0, 1.0)
}

/// What the drawer shows at `now`: everything but the recent items 24 hours old or more.
pub fn shown(drawer: &[DrawerItem], now: i64) -> Vec<&DrawerItem> {
    drawer
        .iter()
        .filter(|d| d.kind != DrawerKind::Recent || now - d.at < GONE_AFTER)
        .collect()
}
