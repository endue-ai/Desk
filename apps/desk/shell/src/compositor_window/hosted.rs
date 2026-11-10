//! The windows the compositor hosts (#81, ADR 0151): the runtime's desk mirrored into `desk-wm`,
//! its plan for the desktop in front, the live budget and the surfaces' lifecycle. Each report
//! from the page gives a new plan; the budget decides who keeps a renderer from it, and the runtime
//! hears that set (`desk://compositor-live`) and carries it out: it asks a window for its
//! `desk:state`, takes its frame away and puts it back (until #83). The surfaces follow the frames
//! the runtime reports, never where a frame sits in the page, so nothing loads again when a window
//! is split, put away or shown on another desktop.

use std::collections::BTreeSet;
use std::time::Instant;

use desk_compositor::{ChromeTheme, Tokens};
use desk_core::TokenTable;
use desk_surface::generated::CompositorMessage;
use desk_wm::{FrameDoc, FrameState, LiveBudget, Plan, Seat, Step, Surfaces};
use serde_json::json;

use super::report::{DeskReport, FrameReport};

/// What a look at the desk calls for.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    pub steps: Vec<Step>,
    /// The windows that keep a renderer, when the set changed: for the runtime.
    pub live: Option<Vec<String>>,
}

/// The chrome's look from the core's token table (ADR 0146).
pub fn look(table: &TokenTable) -> ChromeTheme {
    let tokens: Tokens = table
        .tokens
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    ChromeTheme::from_tokens(&tokens)
}

/// A step as the protocol's message; `None` for a load, which is the web host's own.
pub fn message(step: &Step) -> Option<CompositorMessage> {
    let size = |(w, h): (u32, u32)| json!({ "width": w, "height": h });
    let value = match step {
        Step::Load { .. } => return None,
        Step::Create {
            surface,
            plugin,
            view,
            size: s,
            scale,
            hidden,
        } => json!({ "type": "create", "surface": surface, "plugin": plugin, "view": view,
            "size": size(*s), "scale": scale, "format": "bgra8", "hidden": hidden }),
        Step::Resize {
            surface,
            size: s,
            scale,
        } => json!({ "type": "resize", "surface": surface, "size": size(*s), "scale": scale }),
        Step::Wake {
            surface,
            size: s,
            scale,
        } => json!({ "type": "wake", "surface": surface, "size": size(*s), "scale": scale }),
        Step::Show { surface } => json!({ "type": "show", "surface": surface }),
        Step::Hide { surface } => json!({ "type": "hide", "surface": surface }),
        Step::Sleep { surface } => json!({ "type": "sleep", "surface": surface }),
        Step::Destroy { surface } => json!({ "type": "destroy", "surface": surface }),
    };
    serde_json::from_value(value).ok()
}

/// The plugin id and the manifest's surface a surface host names.
pub fn owner(host: &str) -> Option<(String, String)> {
    match desk_web::plugin_scheme::hosts::Host::parse(Some(host))? {
        desk_web::plugin_scheme::hosts::Host::Surface {
            surface, plugin, ..
        } => Some((plugin, surface.to_owned())),
        _ => None,
    }
}

/// The hosted desk.
pub struct Hosted {
    report: Option<DeskReport>,
    plan: Option<Plan>,
    budget: LiveBudget,
    surfaces: Surfaces,
    docs: Vec<FrameDoc>,
    scale: f64,
    occluded: bool,
    sent: Option<Vec<String>>,
    next: Option<f64>,
    origin: Instant,
}

impl Hosted {
    pub fn new(scale: f64) -> Hosted {
        Hosted {
            report: None,
            plan: None,
            budget: LiveBudget::new(),
            surfaces: Surfaces::new(),
            docs: Vec::new(),
            scale,
            occluded: false,
            sent: None,
            next: None,
            origin: Instant::now(),
        }
    }

    /// Take the page's `report` at `now`, unless an older one; what follows.
    pub fn apply(&mut self, report: DeskReport, now: Instant) -> Outcome {
        if self.report.as_ref().is_some_and(|r| report.seq < r.seq) {
            return Outcome::default();
        }
        let plan = (report.desk).host_plan(report.width, report.height, report.top, &report);
        self.docs = report.frames.iter().filter_map(doc).collect();
        let adopted: Vec<String> = report.desk.adopted.iter().map(|a| a.id.clone()).collect();
        self.count(&adopted, &report.frames);
        self.plan = Some(plan);
        self.report = Some(report);
        self.look(now)
    }

    /// The budget counts every plugin window the runtime handed over, in the order they came, its
    /// frame's state as reported (one never reported counts as live: the set keeps it while it is
    /// in sight, so its frame comes back); a stopped one is the person's to load again, so it is not
    /// counted until it is back (the runtime's policy does the same).
    fn count(&mut self, adopted: &[String], frames: &[FrameReport]) {
        let stopped: BTreeSet<&str> = (frames.iter())
            .filter(|f| f.state == FrameState::Stopped)
            .map(|f| f.plugin.as_str())
            .collect();
        let held: BTreeSet<&str> = (adopted.iter().map(String::as_str))
            .filter(|id| !stopped.contains(id))
            .collect();
        let counted: Vec<String> = self.budget.order().to_vec();
        for id in counted.iter().filter(|id| !held.contains(id.as_str())) {
            self.budget.untrack(id);
        }
        for id in adopted.iter().filter(|id| held.contains(id.as_str())) {
            self.budget.track(id);
            let away = (frames.iter().find(|f| &f.plugin == id)).is_some_and(|f| f.state.away());
            self.budget.reported(id, away);
        }
    }

    /// Decide again and step the surfaces: after a report, a new scale, the window off screen or
    /// back, or when a hidden window's time runs out.
    fn look(&mut self, now: Instant) -> Outcome {
        let (Some(plan), Some(report)) = (&self.plan, &self.report) else {
            return Outcome::default();
        };
        let ms = now.duration_since(self.origin).as_secs_f64() * 1000.0;
        let decision = self.budget.decide(
            &plan.shown,
            plan.focused_plugin.as_deref(),
            report.budget.live,
            report.budget.after_ms,
            ms,
        );
        self.next = decision.next;
        let live: Vec<String> = decision.keep.into_iter().collect();
        let changed = self.sent.as_ref() != Some(&live);
        if changed {
            self.sent = Some(live.clone());
        }
        // A window's plugin sits where the plan puts its pane; one of the page's own system layer
        // (an overlay, an edge bar) where the page lays it out.
        let seat = |plugin: &str| {
            let placed = (report.frames.iter().find(|f| f.plugin == plugin)).and_then(|f| f.place);
            match placed {
                Some(p) => Seat {
                    size: Some((p.width, p.height)),
                    visible: p.shown && p.width > 0.0 && p.height > 0.0,
                },
                None => plan.seat(plugin),
            }
        };
        let steps = (self.surfaces).occluded(self.occluded, &self.docs, seat, self.scale);
        Outcome {
            steps,
            live: changed.then_some(live),
        }
    }

    /// The window has a new scale (another display).
    pub fn rescale(&mut self, scale: f64, now: Instant) -> Outcome {
        self.scale = scale;
        self.look(now)
    }

    /// The window went off screen or came back.
    pub fn occluded(&mut self, occluded: bool, now: Instant) -> Outcome {
        self.occluded = occluded;
        self.look(now)
    }

    /// A hidden window's time may have run out.
    pub fn tick(&mut self, now: Instant) -> Outcome {
        match self.due() {
            Some(due) if now >= due => self.look(now),
            _ => Outcome::default(),
        }
    }

    /// When the budget looks again by itself.
    pub fn due(&self) -> Option<Instant> {
        let ms = self.next?;
        Some(self.origin + std::time::Duration::from_secs_f64(ms.max(0.0) / 1000.0))
    }

    /// Surface `surface`'s renderer died: the runtime loads its window again (#44).
    pub fn died(&mut self, surface: &str) {
        self.surfaces.died(surface);
    }

    pub fn plan(&self) -> Option<&Plan> {
        self.plan.as_ref()
    }

    pub fn report(&self) -> Option<&DeskReport> {
        self.report.as_ref()
    }

    pub fn surfaces(&self) -> &Surfaces {
        &self.surfaces
    }

    /// The runtime's report of plugin `plugin`'s frame.
    pub fn frame(&self, plugin: &str) -> Option<&FrameReport> {
        self.report
            .as_ref()?
            .frames
            .iter()
            .find(|f| f.plugin == plugin)
    }

    /// The windows that keep a renderer, as last decided.
    pub fn live(&self) -> &[String] {
        self.sent.as_deref().unwrap_or_default()
    }
}

/// A frame as `desk-wm` reads it: only a plugin surface's host names one.
fn doc(frame: &FrameReport) -> Option<FrameDoc> {
    let (_, view) = owner(&frame.host)?;
    Some(FrameDoc {
        plugin: frame.plugin.clone(),
        surface: frame.host.clone(),
        view,
        src: frame.src.clone(),
        loads: frame.loads,
        state: frame.state,
    })
}

#[cfg(test)]
#[path = "hosted_tests.rs"]
mod tests;
