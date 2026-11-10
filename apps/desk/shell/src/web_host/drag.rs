//! Drag and drop between a plugin page and the compositor's broker (#56, ADR 0119). The SDK speaks
//! its own messages (`desk:drag-start`, `desk:drop-types`, `desk:drag-status`, `desk:drop-done`
//! up; `desk:dragenter`, `desk:dragover`, `desk:dragleave`, `desk:drop`, `desk:drag-ended` down,
//! with its drag ids and hover sequence numbers), unchanged from Stage 1; the broker speaks the
//! surface protocol's `drag.*`. Each surface keeps the ids that join the two: the SDK's id for the
//! drag it started, the id and sequence number of the drag over it, the drop it was handed. A status
//! for an older hover is dropped, so the broker hears answers to the last one only. The SDK's own
//! moves and release are not needed: the compositor owns the pointer during a drag.

use desk_surface::generated::{
    CompositorMessage as M, SurfaceDragAccept, SurfaceDragDone, SurfaceDragImage, SurfaceDragItem,
    SurfaceDragStart, SurfaceDragStatus, SurfaceDropAnswer, SurfaceDropEffect, SurfaceMessage,
    SurfaceModifier,
};
use serde_json::{Value, json};

/// One surface's side of the drags it takes part in.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct DragIds {
    /// The SDK's id for the drag this surface started.
    source: Option<i64>,
    /// The id this surface knows the drag over it by, and the last hover's sequence number.
    over: u64,
    seq: u64,
    keys: Value,
    /// The drag whose drop this surface was handed.
    dropped: Option<u64>,
}

/// What a page's message means to the broker.
#[derive(Clone, Debug, PartialEq)]
pub enum Up {
    /// Not about drags: relay it to the runtime as before.
    Pass,
    /// About drags: the broker hears these (none: a stale answer) and the runtime nothing.
    Take(Vec<SurfaceMessage>),
    /// Both: the runtime hears it, and the broker these (the page started over).
    Both(Vec<SurfaceMessage>),
    /// Answer the page at once, the broker hears nothing: a start that does not even parse.
    Answer(String),
}

fn answer(m: &Value) -> SurfaceDropAnswer {
    serde_json::from_value(m.get("effect").cloned().unwrap_or(Value::Null))
        .unwrap_or(SurfaceDropAnswer::None)
}

impl DragIds {
    /// The page of `surface` posted `text` to its parent.
    pub fn up(&mut self, surface: &str, text: &str) -> Up {
        let Ok(m) = serde_json::from_str::<Value>(text) else {
            return Up::Pass;
        };
        let kind = m.get("type").and_then(Value::as_str).unwrap_or("");
        let surface = surface.to_owned();
        match kind {
            "desk:hello" => Up::Both(vec![SurfaceMessage::SurfaceDragAccept(SurfaceDragAccept {
                r#type: Default::default(),
                surface,
                types: Vec::new(),
            })]),
            "desk:drop-types" => {
                let types = m
                    .get("types")
                    .and_then(Value::as_array)
                    .map(|all| {
                        all.iter()
                            .filter_map(Value::as_str)
                            .map(str::to_owned)
                            .collect()
                    })
                    .unwrap_or_default();
                Up::Take(vec![SurfaceMessage::SurfaceDragAccept(SurfaceDragAccept {
                    r#type: Default::default(),
                    surface,
                    types,
                })])
            }
            "desk:drag-start" => self.start(surface, &m),
            "desk:drag-status" => {
                let current = m.get("drag").and_then(Value::as_u64) == Some(self.over)
                    && m.get("seq").and_then(Value::as_u64) == Some(self.seq);
                let status = SurfaceMessage::SurfaceDragStatus(SurfaceDragStatus {
                    r#type: Default::default(),
                    surface,
                    effect: answer(&m),
                });
                Up::Take(if current { vec![status] } else { Vec::new() })
            }
            "desk:drop-done" => {
                let mine = m
                    .get("drag")
                    .and_then(Value::as_u64)
                    .is_some_and(|d| self.dropped == Some(d));
                if mine {
                    self.dropped = None;
                }
                let done = SurfaceMessage::SurfaceDragDone(SurfaceDragDone {
                    r#type: Default::default(),
                    surface,
                    effect: answer(&m),
                });
                Up::Take(if mine { vec![done] } else { Vec::new() })
            }
            "desk:drag-move" | "desk:drag-end" | "desk:drag-cancel" => Up::Take(Vec::new()),
            _ => Up::Pass,
        }
    }

    fn start(&mut self, surface: String, m: &Value) -> Up {
        let Some(local) = m.get("drag").and_then(Value::as_i64) else {
            return Up::Take(Vec::new());
        };
        let items: Option<Vec<SurfaceDragItem>> =
            serde_json::from_value(m.get("items").cloned().unwrap_or(Value::Null)).ok();
        let effects: Option<Vec<SurfaceDropEffect>> = match m.get("effectAllowed") {
            None => Some(vec![
                SurfaceDropEffect::Copy,
                SurfaceDropEffect::Move,
                SurfaceDropEffect::Link,
            ]),
            Some(v) => serde_json::from_value(v.clone()).ok(),
        };
        let image: Option<SurfaceDragImage> = m
            .get("image")
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let (Some(items), Some(effect_allowed)) = (items, effects) else {
            let ended = json!({ "type": "desk:drag-ended", "drag": local, "effect": "none" });
            return Up::Answer(ended.to_string());
        };
        self.source = Some(local);
        Up::Take(vec![SurfaceMessage::SurfaceDragStart(SurfaceDragStart {
            r#type: Default::default(),
            surface,
            items,
            effect_allowed,
            image,
        })])
    }

    /// The broker's `message` for this surface, as the SDK's message to post to its page.
    pub fn down(&mut self, message: &M) -> Option<String> {
        let keys = |mods: &[SurfaceModifier]| {
            let held = |m| mods.contains(&m);
            json!({ "alt": held(SurfaceModifier::Alt), "shift": held(SurfaceModifier::Shift),
                "ctrl": held(SurfaceModifier::Ctrl), "meta": held(SurfaceModifier::Meta) })
        };
        let out = match message {
            M::SurfaceDragEnter(e) => {
                self.over += 1;
                self.seq = 1;
                self.keys = keys(&e.modifiers);
                json!({ "type": "desk:dragenter", "drag": self.over, "seq": self.seq, "types": e.types,
                    "effectAllowed": e.effect_allowed, "from": e.from, "x": e.x, "y": e.y, "keys": self.keys })
            }
            M::SurfaceDragOver(o) => {
                self.seq += 1;
                self.keys = keys(&o.modifiers);
                json!({ "type": "desk:dragover", "drag": self.over, "seq": self.seq, "x": o.x, "y": o.y,
                    "keys": self.keys })
            }
            M::SurfaceDragLeave(_) => json!({ "type": "desk:dragleave", "drag": self.over }),
            M::SurfaceDragDrop(d) => {
                self.dropped = Some(self.over);
                json!({ "type": "desk:drop", "drag": self.over, "x": d.x, "y": d.y, "keys": self.keys,
                    "effect": d.effect, "items": d.items })
            }
            M::SurfaceDragEnded(e) => {
                let local = self.source.take()?;
                let mut ended =
                    json!({ "type": "desk:drag-ended", "drag": local, "effect": e.effect });
                if let Some(to) = &e.to {
                    ended["to"] = json!(to);
                }
                ended
            }
            _ => return None,
        };
        Some(out.to_string())
    }
}

/// Whether `message` is the broker's for a surface.
pub fn is_drag(message: &M) -> bool {
    matches!(
        message,
        M::SurfaceDragEnter(_)
            | M::SurfaceDragOver(_)
            | M::SurfaceDragLeave(_)
            | M::SurfaceDragDrop(_)
            | M::SurfaceDragEnded(_)
    )
}

#[cfg(test)]
#[path = "drag_tests.rs"]
mod tests;
