//! What `desk-wm` hands the runtime when it changed the desk (ADR 0153, #83): the whole desk under
//! a revision, with what the runtime reads of it (`View`) and the answers to its edits. The
//! runtime keeps no window manager state of its own: it takes each as the desk, and its next
//! report says which revision it took (`applied`), which is where the page lays the windows out.
//! A gesture's change is one `Change`: a window's whole geometry (its rect in its mode, the mode,
//! the fill and where it comes back to), or the pan of a canvas.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::desk::Desk;
use crate::types::{Fill, Offset, Placement, Restore};
use crate::view::View;

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

/// One change a gesture or a window command made.
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Window { desktop: String, geometry: Geometry },
    Pan { desktop: String, pan: Offset },
}

impl Change {
    /// Make it on `desk`.
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

/// The answers to a batch of the runtime's edits, one per edit, for the batch it numbered `seq`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Answered {
    pub seq: u64,
    pub values: Vec<Value>,
}

/// What the runtime hears (`desk://compositor-wm`): the whole desk under a revision, what it reads
/// of it, and the answers to the edits it asked for when this change was theirs.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Published {
    pub rev: u64,
    pub desk: Desk,
    pub view: View,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answered: Option<Answered>,
}
