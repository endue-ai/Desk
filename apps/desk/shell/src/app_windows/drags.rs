//! Drag and drop in a window out of the canvas (#235, ADR 0119, ADR 0205): what the compositor's
//! broker does on the canvas (`desk-compositor`'s `input/dnd`), for the one page of an app window,
//! with the same rules and the SDK's messages (`web_host/drag.rs`).
//!
//! * **From the OS.** The browser takes an OS drag of files itself and gives the shell their paths
//!   as it enters (`client.rs`); the page's shim says where it is (`desk:os-dragover`, `-dragleave`,
//!   `-drop`, `web_host/shim.js`). The page's targets hear `desk:dragenter`, `dragover` and
//!   `dragleave` with the types they take (`desk/paths`, copy or link), never the items, and only if
//!   they take one; a drop hands them the items when they answered an effect. A drop they do not
//!   take opens its files, as on the canvas: the paths of the drag that entered, once.
//! * **Within the page.** A drag the page starts lands on its own targets. It cannot leave the
//!   window, as one cannot leave the desk's (ADR 0119): past its edge it is over nothing, and let
//!   go there it ends with `none`.

use desk_compositor::input::dnd::data::{EFFECTS, path_holds, paths_item, read_effects};
use desk_compositor::input::dnd::data::{read_answer, with_fallback};
use desk_compositor::input::dnd::{read_items, taken, type_of};
use desk_surface::generated::{SurfaceDragItem, SurfaceDropAnswer, SurfaceDropEffect};
use serde_json::{Value, json};

pub use desk_compositor::input::dnd::ANSWER_WAIT;

/// What the window's drags ask of the shell.
#[derive(Clone, Debug, PartialEq)]
pub enum Act {
    /// Post this to the page, as the runtime's message.
    Page(Value),
    /// Open these files: a drop from the OS the page did not take.
    Open(Vec<String>),
    /// Settle the drop under way after `ANSWER_WAIT` (`settle`) if the page has not answered.
    Wait,
}

/// Where a drag over the window comes from.
#[derive(Clone, Debug, PartialEq)]
enum Source {
    /// The OS: these files open if the page does not take them.
    Os(Vec<String>),
    /// The page itself, which knows its drag by this id.
    Page(i64),
}

#[derive(Clone, Debug)]
struct Drag {
    source: Source,
    items: Vec<SurfaceDragItem>,
    allowed: Vec<SurfaceDropEffect>,
    /// The id the page knows the hover by and the number of the last hover sent.
    id: u64,
    seq: u64,
    /// The page's targets heard `dragenter`: they take one of the types offered.
    entered: bool,
    /// The page's answer to hover `answered`, and where the drag was last.
    answer: SurfaceDropAnswer,
    answered: u64,
    at: (f64, f64),
    keys: Value,
    /// Let go: waiting for the answer to the last hover, then for `desk:drop-done`.
    released: bool,
    dropped: bool,
}

impl Drag {
    fn new(source: Source, items: Vec<SurfaceDragItem>, allowed: Vec<SurfaceDropEffect>) -> Drag {
        Drag {
            source,
            items,
            allowed,
            id: 0,
            seq: 0,
            entered: false,
            answer: SurfaceDropAnswer::None,
            answered: 0,
            at: (f64::NAN, f64::NAN),
            keys: Value::Null,
            released: false,
            dropped: false,
        }
    }
}

/// One app window's drags: what its page's targets take, and the drag over it.
#[derive(Debug, Default)]
pub struct Drags {
    /// Who the page is (its plugin key): a drag it starts is from it and lands on it.
    owner: String,
    accept: Vec<String>,
    drag: Option<Drag>,
    next: u64,
    /// The page's size in CSS pixels: a hover outside it is over nothing.
    size: (f64, f64),
}

fn number(m: &Value, key: &str) -> Option<f64> {
    m.get(key).and_then(Value::as_f64).filter(|n| n.is_finite())
}

impl Drags {
    pub fn new(owner: &str) -> Drags {
        Drags {
            owner: owner.to_owned(),
            ..Drags::default()
        }
    }

    /// The page is `w` by `h` CSS pixels now.
    pub fn set_size(&mut self, w: f64, h: f64) {
        self.size = (w, h);
    }

    /// An OS drag carrying `paths` entered the window.
    pub fn os_enter(&mut self, paths: Vec<String>) -> Vec<Act> {
        let paths: Vec<String> = paths.into_iter().filter(|p| path_holds(p)).collect();
        let page = (self.drag.as_ref()).is_some_and(|d| matches!(d.source, Source::Page(_)));
        if paths.is_empty() || page {
            return Vec::new();
        }
        let out = self.leave();
        let items = with_fallback(vec![paths_item(&paths)]);
        let allowed = vec![SurfaceDropEffect::Copy, SurfaceDropEffect::Link];
        self.drag = Some(Drag::new(Source::Os(paths), items, allowed));
        out
    }

    /// The page posted `m`: what to do when it is about drags, `None` to pass it to the runtime.
    pub fn up(&mut self, m: &Value) -> Option<Vec<Act>> {
        let kind = m.get("type").and_then(Value::as_str)?;
        let os = self
            .drag
            .as_ref()
            .is_some_and(|d| matches!(d.source, Source::Os(_)));
        let mine = |d: &Drag| m.get("drag").and_then(Value::as_i64) == Some(Self::local(d));
        let out = match kind {
            // A page that starts over takes nothing yet, and a drag over it is gone.
            "desk:hello" => {
                self.accept.clear();
                self.drag = None;
                return None;
            }
            "desk:drop-types" => {
                let types = m.get("types").and_then(Value::as_array);
                self.accept = (types.into_iter().flatten())
                    .filter_map(Value::as_str)
                    .filter(|t| t.len() <= 160)
                    .take(32)
                    .map(str::to_owned)
                    .collect();
                Vec::new()
            }
            // Where a drag is, and where it was let go: the OS's (as the shim says) or the page's.
            "desk:os-dragover" | "desk:os-drop" | "desk:drag-move" | "desk:drag-end" => {
                let ours = if kind.starts_with("desk:os-") {
                    os
                } else {
                    self.drag.as_ref().is_some_and(mine)
                };
                match (ours && !self.released(), number(m, "x"), number(m, "y")) {
                    (true, Some(x), Some(y)) => {
                        let keys = m.get("keys").cloned().unwrap_or(Value::Null);
                        if kind == "desk:os-drop" || kind == "desk:drag-end" {
                            self.release(x, y, keys)
                        } else {
                            self.hover(x, y, keys)
                        }
                    }
                    _ => Vec::new(),
                }
            }
            "desk:os-dragleave" if os && !self.released() => self.leave(),
            "desk:drag-start" => self.start(m),
            "desk:drag-cancel" if self.drag.as_ref().is_some_and(mine) => {
                let local = self.drag.as_ref().map(Self::local);
                let mut out = self.leave();
                out.extend(local.map(|l| Self::ended(l, SurfaceDropAnswer::None, None)));
                out
            }
            "desk:drag-status" => self.status(m),
            "desk:drop-done" => self.done(m),
            "desk:os-dragleave" | "desk:drag-cancel" => Vec::new(),
            _ => return None,
        };
        Some(out)
    }

    /// `ANSWER_WAIT` passed since a release: it lands on the last answer the page gave.
    pub fn settle(&mut self) -> Vec<Act> {
        match &self.drag {
            Some(d) if d.released && !d.dropped => self.land(),
            _ => Vec::new(),
        }
    }

    /// The page's own id for its drag; -1 for one from the OS, which no page message names.
    fn local(drag: &Drag) -> i64 {
        match drag.source {
            Source::Page(local) => local,
            Source::Os(_) => -1,
        }
    }

    fn released(&self) -> bool {
        self.drag.as_ref().is_some_and(|d| d.released)
    }

    fn ended(local: i64, effect: SurfaceDropAnswer, to: Option<&str>) -> Act {
        let mut ended = json!({ "type": "desk:drag-ended", "drag": local, "effect": effect });
        if let Some(to) = to {
            ended["to"] = json!(to);
        }
        Act::Page(ended)
    }

    fn start(&mut self, m: &Value) -> Vec<Act> {
        let Some(local) = m.get("drag").and_then(Value::as_i64) else {
            return Vec::new();
        };
        let items: Option<Vec<SurfaceDragItem>> =
            serde_json::from_value(m.get("items").cloned().unwrap_or(Value::Null)).ok();
        let allowed: Option<Vec<SurfaceDropEffect>> = match m.get("effectAllowed") {
            None => Some(EFFECTS.to_vec()),
            Some(v) => serde_json::from_value(v.clone()).ok(),
        };
        let items = items.as_deref().and_then(read_items);
        let allowed = allowed.as_deref().and_then(read_effects);
        let page = (self.drag.as_ref()).is_some_and(|d| matches!(d.source, Source::Page(_)));
        let (Some(items), Some(allowed), false) = (items, allowed, page) else {
            return vec![Self::ended(local, SurfaceDropAnswer::None, None)];
        };
        // The pointer is pressed in the page: an OS drag that left without a word is over.
        let mut out = self.leave();
        self.drag = Some(Drag::new(Source::Page(local), items, allowed));
        if let (Some(x), Some(y)) = (number(m, "x"), number(m, "y")) {
            out.extend(self.hover(x, y, Value::Null));
        }
        out
    }

    /// The offered types the page's targets take.
    fn types(&self, drag: &Drag) -> Vec<String> {
        let offered: Vec<String> = drag.items.iter().map(type_of).collect();
        taken(&self.accept, &offered)
    }

    /// The drag is at `x`, `y` with `keys` held: the page hears it enter, move or leave.
    fn hover(&mut self, x: f64, y: f64, keys: Value) -> Vec<Act> {
        let (w, h) = self.size;
        let inside = (w <= 0.0 && h <= 0.0) || (x >= 0.0 && y >= 0.0 && x < w && y < h);
        let types = self
            .drag
            .as_ref()
            .map(|d| self.types(d))
            .unwrap_or_default();
        let owner = self.owner.clone();
        let Some(drag) = self.drag.as_mut() else {
            return Vec::new();
        };
        drag.at = (x, y);
        drag.keys = keys.clone();
        if !inside || types.is_empty() {
            return self.leave_hover();
        }
        if drag.entered {
            drag.seq += 1;
            let over = json!({ "type": "desk:dragover", "drag": drag.id, "seq": drag.seq,
                "x": x, "y": y, "keys": keys });
            return vec![Act::Page(over)];
        }
        self.next += 1;
        drag.id = self.next;
        drag.seq = 1;
        drag.entered = true;
        drag.answer = SurfaceDropAnswer::None;
        let from = match drag.source {
            Source::Os(_) => "os".to_owned(),
            Source::Page(_) => owner,
        };
        let enter = json!({ "type": "desk:dragenter", "drag": drag.id, "seq": drag.seq,
            "types": types, "effectAllowed": drag.allowed, "from": from, "x": x, "y": y,
            "keys": keys });
        vec![Act::Page(enter)]
    }

    /// The drag left the page's targets (but goes on): they hear `dragleave`.
    fn leave_hover(&mut self) -> Vec<Act> {
        let Some(drag) = self.drag.as_mut().filter(|d| d.entered) else {
            return Vec::new();
        };
        drag.entered = false;
        drag.answer = SurfaceDropAnswer::None;
        let mut out = vec![Act::Page(
            json!({ "type": "desk:dragleave", "drag": drag.id }),
        )];
        if let Source::Page(local) = drag.source {
            let none = json!({ "type": "desk:drag-feedback", "drag": local, "effect": "none" });
            out.push(Act::Page(none));
        }
        out
    }

    /// The drag is gone without a drop.
    fn leave(&mut self) -> Vec<Act> {
        let out = self.leave_hover();
        self.drag = None;
        out
    }

    /// The drag was let go at `x`, `y`: it lands once the page answers its last hover there.
    fn release(&mut self, x: f64, y: f64, keys: Value) -> Vec<Act> {
        let mut out = self.hover(x, y, keys);
        let Some(drag) = self.drag.as_mut() else {
            return out;
        };
        drag.released = true;
        if drag.entered {
            out.push(Act::Wait);
        } else {
            out.extend(self.land());
        }
        out
    }

    fn status(&mut self, m: &Value) -> Vec<Act> {
        let Some(drag) = self.drag.as_mut().filter(|d| d.entered && !d.dropped) else {
            return Vec::new();
        };
        let seq = m.get("seq").and_then(Value::as_u64).unwrap_or(0);
        if m.get("drag").and_then(Value::as_u64) != Some(drag.id) || seq < drag.answered {
            return Vec::new();
        }
        let answer: SurfaceDropAnswer =
            serde_json::from_value(m.get("effect").cloned().unwrap_or(Value::Null))
                .unwrap_or(SurfaceDropAnswer::None);
        drag.answer = read_answer(answer, &drag.allowed);
        drag.answered = seq;
        let mut out = Vec::new();
        if let Source::Page(local) = drag.source {
            let feedback =
                json!({ "type": "desk:drag-feedback", "drag": local, "effect": drag.answer });
            out.push(Act::Page(feedback));
        }
        if drag.released && seq == drag.seq {
            out.extend(self.land());
        }
        out
    }

    /// The drag lands: on the page's target with its effect, else (from the OS) its files open.
    fn land(&mut self) -> Vec<Act> {
        let types = self
            .drag
            .as_ref()
            .map(|d| self.types(d))
            .unwrap_or_default();
        let Some(drag) = self.drag.as_mut() else {
            return Vec::new();
        };
        if drag.entered && drag.answer != SurfaceDropAnswer::None {
            drag.dropped = true;
            let items: Vec<&SurfaceDragItem> = (drag.items.iter())
                .filter(|item| types.contains(&type_of(item)))
                .collect();
            let (x, y) = drag.at;
            let drop = json!({ "type": "desk:drop", "drag": drag.id, "x": x, "y": y,
                "keys": drag.keys, "effect": drag.answer, "items": items });
            // A drop from the OS ends here; the page's own drag ends with the effect performed.
            if matches!(drag.source, Source::Os(_)) {
                self.drag = None;
            }
            return vec![Act::Page(drop)];
        }
        let source = drag.source.clone();
        let mut out = self.leave();
        match source {
            Source::Os(paths) => out.push(Act::Open(paths)),
            Source::Page(local) => out.push(Self::ended(local, SurfaceDropAnswer::None, None)),
        }
        out
    }

    fn done(&mut self, m: &Value) -> Vec<Act> {
        let Some(drag) = self.drag.as_ref().filter(|d| d.dropped) else {
            return Vec::new();
        };
        if m.get("drag").and_then(Value::as_u64) != Some(drag.id) {
            return Vec::new();
        }
        let answer: SurfaceDropAnswer =
            serde_json::from_value(m.get("effect").cloned().unwrap_or(Value::Null))
                .unwrap_or(SurfaceDropAnswer::None);
        let effect = read_answer(answer, &drag.allowed);
        let local = Self::local(drag);
        self.drag = None;
        let to = (effect != SurfaceDropAnswer::None).then_some(self.owner.as_str());
        vec![Self::ended(local, effect, to)]
    }
}

#[cfg(test)]
#[path = "drags_tests.rs"]
mod tests;
