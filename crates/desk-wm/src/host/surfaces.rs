//! The plugin surfaces the host made and the lifecycle steps (`specs/surface/v0/lifecycle.md`)
//! each new look at the desk calls for. A surface is keyed by its host (`<surface>.<plugin
//! label>`, #36), never by where its window is, so a split, the drawer, a desktop switch or a
//! profile switch only moves, resizes, hides or shows it: its document never loads again (ADR
//! 0040's reload goes). It loads again only for a new document (a new revision: hot reload), and
//! after it died, when its holder loads it again (#44). It `sleep`s when its holder took its frame
//! away (the live budget's decision carried out, or a frame the person stopped) and `wake`s when
//! the frame is back; one with no visible window, or the app window off screen, is `hide`.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// What a plugin's frame is doing, as its holder (the runtime, ADR 0156) says.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FrameState {
    /// Loaded and answering.
    #[default]
    Live,
    /// Put to sleep by the live budget, its state kept.
    Asleep,
    /// Loaded but not answering for 5 s: Not responding.
    Late,
    /// Stopped by the person, or held after dying twice; it waits for Reload.
    Stopped,
}

impl FrameState {
    /// Its frame is away: no renderer until it is back.
    pub fn away(self) -> bool {
        matches!(self, FrameState::Asleep | FrameState::Stopped)
    }
}

/// One plugin surface as its holder reports it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FrameDoc {
    pub plugin: String,
    /// Its host, `<surface>.<plugin label>`: the protocol's surface id.
    pub surface: String,
    /// The manifest's surface it draws.
    #[serde(default)]
    pub view: String,
    /// The document it shows.
    pub src: String,
    /// How many times its frame loaded in the page: it moves when the page moves the frame, and
    /// when the holder loads it again after a death.
    #[serde(default)]
    pub loads: u64,
    #[serde(default)]
    pub state: FrameState,
}

/// A lifecycle step for one surface (`CompositorMessage`), or the document it shows.
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    /// Show this document (before its `create`, or a new revision).
    Load {
        surface: String,
        url: String,
    },
    Create {
        surface: String,
        plugin: String,
        view: String,
        size: (u32, u32),
        scale: f64,
        hidden: bool,
    },
    Resize {
        surface: String,
        size: (u32, u32),
        scale: f64,
    },
    Show {
        surface: String,
    },
    Hide {
        surface: String,
    },
    Sleep {
        surface: String,
    },
    Wake {
        surface: String,
        size: (u32, u32),
        scale: f64,
    },
    Destroy {
        surface: String,
    },
}

impl Step {
    /// The surface it is about.
    pub fn surface(&self) -> &str {
        match self {
            Step::Load { surface, .. }
            | Step::Create { surface, .. }
            | Step::Resize { surface, .. }
            | Step::Show { surface }
            | Step::Hide { surface }
            | Step::Sleep { surface }
            | Step::Wake { surface, .. }
            | Step::Destroy { surface } => surface,
        }
    }
}

#[derive(Clone, Debug)]
struct Known {
    plugin: String,
    src: String,
    loads: u64,
    size: (u32, u32),
    scale: f64,
    hidden: bool,
    asleep: bool,
    dead: bool,
}

/// Where each plugin is on screen, from the plan: its pane's size, and whether it is in sight.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seat {
    /// The pane's logical size; `None` for a plugin with no window on the desktop in front.
    pub size: Option<(f64, f64)>,
    pub visible: bool,
}

/// The surfaces made so far, by host.
#[derive(Clone, Debug, Default)]
pub struct Surfaces {
    known: BTreeMap<String, Known>,
    occluded: bool,
}

/// A logical size in whole pixels, at least one.
fn whole((w, h): (f64, f64)) -> (u32, u32) {
    let px = |v: f64| {
        if v.is_finite() {
            v.round().max(1.0) as u32
        } else {
            1
        }
    };
    (px(w), px(h))
}

impl Surfaces {
    pub fn new() -> Surfaces {
        Surfaces::default()
    }

    /// The steps that take the surfaces to `frames`, each seated by `seat`, at `scale`.
    pub fn apply(
        &mut self,
        frames: &[FrameDoc],
        seat: impl Fn(&str) -> Seat,
        scale: f64,
    ) -> Vec<Step> {
        let mut steps = Vec::new();
        for doc in frames {
            self.place(doc, seat(&doc.plugin), scale, &mut steps);
        }
        let present: BTreeSet<&str> = frames.iter().map(|d| d.surface.as_str()).collect();
        let gone: Vec<String> = (self.known.keys())
            .filter(|host| !present.contains(host.as_str()))
            .cloned()
            .collect();
        for surface in gone {
            self.known.remove(&surface);
            steps.push(Step::Destroy { surface });
        }
        steps
    }

    fn place(&mut self, doc: &FrameDoc, seat: Seat, scale: f64, steps: &mut Vec<Step>) {
        let surface = doc.surface.clone();
        let hidden = self.occluded || !seat.visible;
        let load = |steps: &mut Vec<Step>| {
            steps.push(Step::Load {
                surface: surface.clone(),
                url: doc.src.clone(),
            })
        };
        let Some(known) = self.known.get_mut(&doc.surface) else {
            if doc.state.away() {
                return; // first seen away (it started asleep): made when it is back
            }
            let size = whole(seat.size.unwrap_or((1.0, 1.0)));
            load(steps);
            steps.push(Step::Create {
                surface: surface.clone(),
                plugin: doc.plugin.clone(),
                view: doc.view.clone(),
                size,
                scale,
                hidden,
            });
            let known = Known {
                plugin: doc.plugin.clone(),
                src: doc.src.clone(),
                loads: doc.loads,
                size,
                scale,
                hidden,
                asleep: false,
                dead: false,
            };
            self.known.insert(surface, known);
            return;
        };
        if doc.state.away() {
            if !known.asleep {
                known.asleep = true;
                known.dead = false;
                steps.push(Step::Sleep { surface });
            }
            return;
        }
        let size = seat.size.map_or(known.size, whole);
        let new_document = doc.src != known.src;
        let loaded_again = new_document || doc.loads > known.loads;
        if known.asleep || (known.dead && loaded_again) {
            if new_document {
                load(steps);
            }
            // It wakes as hidden as it went to sleep; the show or hide below says how it is now.
            known.size = size;
            known.scale = scale;
            steps.push(Step::Wake {
                surface: surface.clone(),
                size,
                scale,
            });
            known.asleep = false;
            known.dead = false;
        } else if new_document && !known.dead {
            load(steps);
        }
        known.src = doc.src.clone();
        known.loads = doc.loads;
        known.plugin = doc.plugin.clone();
        if (known.size, known.scale) != (size, scale) {
            known.size = size;
            known.scale = scale;
            steps.push(Step::Resize {
                surface: surface.clone(),
                size,
                scale,
            });
        }
        if known.hidden != hidden {
            known.hidden = hidden;
            steps.push(if hidden {
                Step::Hide { surface }
            } else {
                Step::Show { surface }
            });
        }
    }

    /// Surface `surface`'s renderer died: it waits for its holder to load it again.
    pub fn died(&mut self, surface: &str) {
        if let Some(known) = self.known.get_mut(surface) {
            known.dead = true;
        }
    }

    /// Whether `surface` died and was not loaded again since.
    pub fn dead(&self, surface: &str) -> bool {
        self.known.get(surface).is_some_and(|k| k.dead)
    }

    /// The app window went off screen (`true`) or came back: every surface hides, or shows again
    /// as `frames` seat it.
    pub fn occluded(
        &mut self,
        occluded: bool,
        frames: &[FrameDoc],
        seat: impl Fn(&str) -> Seat,
        scale: f64,
    ) -> Vec<Step> {
        self.occluded = occluded;
        self.apply(frames, seat, scale)
    }

    /// The surfaces made, by host, with their plugin and whether each is asleep.
    pub fn made(&self) -> Vec<(String, String, bool)> {
        (self.known.iter())
            .map(|(host, k)| (host.clone(), k.plugin.clone(), k.asleep))
            .collect()
    }

    /// The surface of plugin `plugin`, once made.
    pub fn of(&self, plugin: &str) -> Option<&str> {
        (self.known.iter())
            .find(|(_, k)| k.plugin == plugin)
            .map(|(host, _)| host.as_str())
    }
}
