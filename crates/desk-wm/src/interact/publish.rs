//! What `desk-wm` hands the runtime when it changed the desk (ADR 0152): each window it moved,
//! resized, snapped or filled, with its whole geometry (its rect in its mode, the mode, the fill
//! and where it comes back to), and the pan of a canvas it panned, under a revision. The runtime
//! takes them as the truth and writes them into its store as session edits; the desk it publishes
//! next says which revision it took (`applied`), and until then `desk-wm` keeps drawing its own.

use serde::{Deserialize, Serialize};

use crate::desk::Desk;
use crate::types::{Fill, Offset, Placement, Restore};

/// A window's geometry, as its placement keeps it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Geometry {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub floating: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fill: Option<Fill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub restore: Option<Restore>,
}

impl Geometry {
    pub fn of(p: &Placement) -> Geometry {
        Geometry {
            id: p.id.clone(),
            x: p.x,
            y: p.y,
            w: p.w,
            h: p.h,
            floating: p.floating,
            fill: p.fill,
            restore: p.restore,
        }
    }

    /// `p` with this geometry; everything else of it stays.
    pub fn set(&self, p: &mut Placement) {
        p.x = self.x;
        p.y = self.y;
        p.w = self.w;
        p.h = self.h;
        p.floating = self.floating;
        p.fill = self.fill;
        p.restore = self.restore;
    }
}

/// One change `desk-wm` made.
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Window { desktop: String, geometry: Geometry },
    Pan { desktop: String, pan: Offset },
}

impl Change {
    /// Make it again on `desk`: the runtime has not taken it yet.
    pub fn apply(&self, desk: &mut Desk) {
        match self {
            Change::Window { desktop, geometry } => {
                if desk.here() == *desktop {
                    desk.update(&geometry.id, |p| geometry.set(p));
                } else {
                    desk.edit_at(desktop.as_str(), |l| {
                        if let Some(p) = l.surfaces.iter_mut().find(|p| p.id == geometry.id) {
                            geometry.set(p);
                        }
                    });
                }
            }
            Change::Pan { desktop, pan } => {
                desk.pan.insert(desktop.clone(), *pan);
            }
        }
    }
}

/// What the runtime hears (`desk://compositor-wm`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Published {
    pub rev: u64,
    pub desktop: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub windows: Vec<Geometry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pan: Option<Offset>,
}

impl Published {
    /// `change` under revision `rev`.
    pub fn of(rev: u64, change: &Change) -> Published {
        match change {
            Change::Window { desktop, geometry } => Published {
                rev,
                desktop: desktop.clone(),
                windows: vec![geometry.clone()],
                pan: None,
            },
            Change::Pan { desktop, pan } => Published {
                rev,
                desktop: desktop.clone(),
                windows: Vec::new(),
                pan: Some(*pan),
            },
        }
    }
}
