//! Where the runtime places each plugin surface (compositor mode, #52), as the shell page reports it
//! (`apps/desk/src/compositor-layout.ts`), and the surface protocol messages that follow: a new
//! surface is `create`d, one that left the report `destroy`ed; a frame the runtime unloaded `sleep`s
//! and `wake`s when it is back; its size or scale is `resize`; no visible part (covered, put away, the
//! window occluded) is `hide`, back in sight `show`. A new document (a revision, a reload) is a load
//! of the web host's own. The window manager stays in the runtime until #53.

use std::collections::HashMap;

use desk_surface::generated::CompositorMessage;
use serde::Deserialize;
use serde_json::json;

/// A rectangle in the shell page's CSS pixels.
#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
pub struct Box {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq)]
pub struct Size {
    pub width: f64,
    pub height: f64,
}

/// One plugin surface's frame in the shell page.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Placed {
    /// The surface's host, `<surface>.<plugin label>`: its id here.
    pub host: String,
    /// The document its frame loads (the stand-in's URL).
    pub src: String,
    /// How many times the frame loaded: a reload with the same URL counts.
    pub loads: u64,
    /// The frame's layout size: what the plugin's page lays out at.
    pub size: Size,
    /// Where the frame is on the page (its bounding box, after transforms).
    pub rect: Box,
    /// The parts of `rect` nothing covers; none when it is out of sight.
    #[serde(default)]
    pub pieces: Vec<Box>,
    /// The runtime unloaded the frame (ADR 0070, ADR 0142).
    #[serde(default)]
    pub asleep: bool,
}

/// The shell page's report.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Report {
    /// Counts up with every report; an older one arriving late is ignored.
    pub seq: u64,
    /// Device pixels per CSS pixel.
    pub scale: f64,
    pub surfaces: Vec<Placed>,
}

/// What follows from a report.
#[derive(Clone, Debug, PartialEq)]
pub enum Step {
    /// The web host shows this document for the surface (before its `create`, or a new one).
    Load {
        surface: String,
        url: String,
    },
    Send(CompositorMessage),
}

#[derive(Clone, Debug)]
struct Known {
    src: String,
    loads: u64,
    size: (u32, u32),
    scale: f64,
    hidden: bool,
    asleep: bool,
    dead: bool,
}

/// The surfaces the compositor made from the reports, and the last report.
#[derive(Default)]
pub struct Layout {
    seq: u64,
    known: HashMap<String, Known>,
    /// The last report's surfaces.
    pub placed: Vec<Placed>,
    pub scale: f64,
    /// The compositor window is off screen: every surface is hidden.
    occluded: bool,
}

fn message(value: serde_json::Value) -> Step {
    Step::Send(serde_json::from_value(value).expect("a compositor message the spec allows"))
}

fn size_json(size: (u32, u32)) -> serde_json::Value {
    json!({ "width": size.0, "height": size.1 })
}

/// The plugin id and surface id a surface host names.
pub fn owner(host: &str) -> Option<(String, String)> {
    match desk_web::plugin_scheme::hosts::Host::parse(Some(host))? {
        desk_web::plugin_scheme::hosts::Host::Surface {
            surface, plugin, ..
        } => Some((plugin, surface.to_owned())),
        _ => None,
    }
}

impl Layout {
    /// Take `report`, unless an earlier one; what the web host must hear.
    pub fn apply(&mut self, report: Report) -> Vec<Step> {
        if report.seq < self.seq {
            return Vec::new();
        }
        self.seq = report.seq;
        self.scale = report.scale;
        let mut steps = Vec::new();
        for placed in &report.surfaces {
            self.place(placed, report.scale, &mut steps);
        }
        let gone: Vec<String> = self
            .known
            .keys()
            .filter(|host| !report.surfaces.iter().any(|p| &p.host == *host))
            .cloned()
            .collect();
        for host in gone {
            self.known.remove(&host);
            steps.push(message(json!({ "type": "destroy", "surface": host })));
        }
        self.placed = report.surfaces;
        steps
    }

    fn place(&mut self, placed: &Placed, scale: f64, steps: &mut Vec<Step>) {
        let surface = placed.host.clone();
        let size = (
            placed.size.width.round().max(1.0) as u32,
            placed.size.height.round().max(1.0) as u32,
        );
        let hidden = self.occluded || placed.pieces.is_empty();
        let load = |steps: &mut Vec<Step>| {
            steps.push(Step::Load {
                surface: surface.clone(),
                url: placed.src.clone(),
            })
        };
        let Some(known) = self.known.get_mut(&placed.host) else {
            if placed.asleep {
                return; // first seen asleep (it started asleep): made when it wakes
            }
            let Some((plugin, view)) = owner(&placed.host) else {
                return;
            };
            load(steps);
            steps.push(message(
                json!({ "type": "create", "surface": surface, "plugin": plugin, "view": view,
                "size": size_json(size), "scale": scale, "format": "bgra8", "hidden": hidden }),
            ));
            let known = Known {
                src: placed.src.clone(),
                loads: placed.loads,
                size,
                scale,
                hidden,
                asleep: false,
                dead: false,
            };
            self.known.insert(placed.host.clone(), known);
            return;
        };
        if placed.asleep {
            if !known.asleep {
                known.asleep = true;
                known.dead = false;
                steps.push(message(json!({ "type": "sleep", "surface": surface })));
            }
            return;
        }
        let reloaded = placed.loads > known.loads || placed.src != known.src;
        if known.asleep || (known.dead && reloaded) {
            if placed.src != known.src {
                load(steps);
            }
            known.size = size;
            known.scale = scale;
            steps.push(message(json!({ "type": "wake", "surface": surface, "size": size_json(size), "scale": scale })));
            known.asleep = false;
            known.dead = false;
        } else if reloaded && !known.dead {
            load(steps);
        }
        known.src = placed.src.clone();
        known.loads = placed.loads;
        if (known.size, known.scale) != (size, scale) {
            known.size = size;
            known.scale = scale;
            steps.push(message(json!({ "type": "resize", "surface": surface, "size": size_json(size), "scale": scale })));
        }
        if known.hidden != hidden {
            known.hidden = hidden;
            let kind = if hidden { "hide" } else { "show" };
            steps.push(message(json!({ "type": kind, "surface": surface })));
        }
    }

    /// Surface `surface`'s renderer died: the runtime's reload of its frame wakes it.
    pub fn died(&mut self, surface: &str) {
        if let Some(known) = self.known.get_mut(surface) {
            known.dead = true;
        }
    }

    /// The compositor window went off screen (minimised, covered) or came back.
    pub fn occluded(&mut self, occluded: bool) -> Vec<Step> {
        self.occluded = occluded;
        let placed = std::mem::take(&mut self.placed);
        let mut steps = Vec::new();
        for p in &placed {
            self.place(p, self.scale, &mut steps);
        }
        self.placed = placed;
        steps
    }

    /// The most frames per second every surface may paint (the window in front or behind).
    pub fn pace(&self, fps: u32) -> Vec<Step> {
        let mut hosts: Vec<&String> = self.known.keys().collect();
        hosts.sort();
        hosts
            .into_iter()
            .map(|host| message(json!({ "type": "pace", "surface": host, "fps": fps })))
            .collect()
    }

    /// The surfaces made, by host, and whether each is asleep.
    pub fn surfaces(&self) -> Vec<(String, bool)> {
        let mut all: Vec<(String, bool)> = self
            .known
            .iter()
            .map(|(h, k)| (h.clone(), k.asleep))
            .collect();
        all.sort();
        all
    }
}

#[cfg(test)]
#[path = "layout_tests.rs"]
mod tests;
