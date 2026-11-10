//! A desktop's layout and the profile's saved ones (`DesktopLayout` and `EMPTY_DESKTOP` in
//! `packages/runtime/src/modes`). The JSON is the runtime's, so a session or a profile saved by the
//! web desk reads here unchanged: `eris` is `null` in her default place.
//!
//! Layering a profile (the base, then the profile, then its desktop's own, `savedLayout`) stays with
//! the profiles, the core's records: the window manager reads the result, `Saved`.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::desktops::{Desktop, DesktopId, default_desktops};
use crate::types::{Offset, Placement};

/// Whether a bar shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Visible {
    pub visible: bool,
}

impl Default for Visible {
    fn default() -> Self {
        Self { visible: true }
    }
}

/// One desktop's windows in desk order, where Eris sits (`None`: her default place, centred at the
/// top) and whether the rail and the drawer show. The default is the empty desktop.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct DesktopLayout {
    pub surfaces: Vec<Placement>,
    #[serde(default)]
    pub eris: Option<Offset>,
    #[serde(default)]
    pub rail: Visible,
    #[serde(default)]
    pub drawer: Visible,
}

/// What the profile in force saved, as the window manager reads it: its desktops in order and each
/// one's saved layout, already layered. A desktop it names no layout for has `desktop`, the layout
/// every desktop starts from. A fresh desk's: the four desktops named 1 to 4, all empty.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Saved {
    #[serde(default = "default_desktops")]
    pub list: Vec<Desktop>,
    #[serde(default)]
    pub desktop: DesktopLayout,
    #[serde(default)]
    pub desktops: BTreeMap<DesktopId, DesktopLayout>,
}

impl Default for Saved {
    fn default() -> Self {
        Self {
            list: default_desktops(),
            desktop: DesktopLayout::default(),
            desktops: BTreeMap::new(),
        }
    }
}

impl Saved {
    /// Desktop `id`'s saved layout.
    pub fn layout(&self, id: &str) -> &DesktopLayout {
        self.desktops.get(id).unwrap_or(&self.desktop)
    }

    /// Every window id any of its desktops places.
    pub fn placed(&self) -> impl Iterator<Item = &str> {
        self.list
            .iter()
            .flat_map(|d| self.layout(&d.id).surfaces.iter().map(|p| p.id.as_str()))
    }
}
