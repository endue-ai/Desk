//! The windows the compositor hosts (#81, ADR 0151): `desk-wm`'s window manager
//! (`interact::Wm`, ADR 0153), which holds the desk (#83), changes it on the compositor's input and
//! on the runtime's edits and publishes it whole; its plan for the desktop in front with the
//! windows a gesture holds or that glide, the live budget and the surfaces' lifecycle. Each report
//! from the page, and each change of the window manager's, gives a new plan; the budget decides
//! who keeps a renderer from it, and the runtime hears that set (`desk://compositor-live`) and
//! carries it out: it asks a window for its `desk:state`, takes its frame away and puts it back
//! (ADR 0156). The surfaces follow the frames the runtime reports, never where a frame sits in the
//! page, so nothing loads again when a window is split, put away or shown on another desktop.

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use desk_compositor::{ChromeTheme, Tokens};
use desk_core::TokenTable;
use desk_surface::generated::CompositorMessage;
use desk_wm::interact::{Motion, Out, Wm};
use desk_wm::{FrameDoc, FrameState, LiveBudget, Places, Plan, Rect, Seat, Size, Step, Surfaces};
use serde_json::json;

use super::report::{DeskReport, FrameReport, Layer};

/// What a look at the desk calls for.
#[derive(Debug, Default, PartialEq)]
pub struct Outcome {
    pub steps: Vec<Step>,
    /// The windows that keep a renderer, when the set changed: for the runtime.
    pub live: Option<Vec<String>>,
    /// What the window manager calls for: the runtime's and the page's.
    pub wm: Vec<Out>,
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

/// The window manager's motion from the core's token table: the glides and the snap preview.
pub fn motion(table: &TokenTable) -> Motion {
    Motion::from_tokens(|name| table.tokens.get(name).cloned(), table.reduced_motion)
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
    /// The window manager (#80).
    pub wm: Wm,
    /// The snap preview and the window it lies under, as last planned.
    preview: Option<(Rect, String)>,
    /// Something glides: plan again each frame.
    moving: bool,
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
            wm: Wm::new(),
            preview: None,
            moving: false,
        }
    }

    /// `now` on the window manager's clock, in milliseconds.
    pub fn ms(&self, now: Instant) -> f64 {
        now.saturating_duration_since(self.origin).as_secs_f64() * 1000.0
    }

    /// Take the page's `report` at `now`, unless an older one; what follows.
    pub fn apply(&mut self, report: DeskReport, now: Instant) -> Outcome {
        if self.report.as_ref().is_some_and(|r| report.seq < r.seq) {
            return Outcome::default();
        }
        self.docs = report.frames.iter().filter_map(doc).collect();
        let screen = Size {
            w: report.width,
            h: report.height,
        };
        let wm = self.wm.took(report.applied, screen);
        self.report = Some(report);
        let mut outcome = self.replan(now);
        outcome.wm = wm;
        outcome
    }

    /// Plan again from the window manager's desk at `now`: where each window is drawn (held,
    /// gliding) and where the page lays it out; then look.
    pub fn replan(&mut self, now: Instant) -> Outcome {
        // The budget counts the windows the desk holds now, as their frames were last reported.
        let Some(frames) = self.report.as_ref().map(|r| r.frames.clone()) else {
            return Outcome::default();
        };
        let adopted: Vec<String> = (self.wm.desk().adopted.iter())
            .map(|a| a.id.clone())
            .collect();
        self.count(&adopted, &frames);
        let Some(report) = &self.report else {
            return Outcome::default();
        };
        let frame = self.wm.frame(self.ms(now));
        let page = self.wm.page();
        let pan = page.pan_of(&page.here());
        let (vw, vh) = (report.width, report.height);
        let mut laid: BTreeMap<String, Rect> = (page.windows().iter())
            .map(|p| (p.id.clone(), desk_wm::screen_rect(p, pan, vw, vh)))
            .collect();
        if let Some(h) = &report.held {
            laid.insert(h.window.clone(), Rect::new(h.x, h.y, h.w, h.h));
        }
        let places = Places {
            drawn: frame.drawn,
            page: laid,
        };
        let desk = self.wm.desk();
        let plan = desk.host_plan_at(vw, vh, report.top, report, &places);
        self.plan = Some(plan);
        self.preview = frame.preview;
        self.moving = frame.moving;
        self.look(now)
    }

    /// The number of the last report taken.
    pub fn seq(&self) -> u64 {
        self.report.as_ref().map_or(0, |r| r.seq)
    }

    /// Whether the page's last report says it took and laid out the desk published as `rev`.
    pub fn page_took(&self, rev: u64) -> bool {
        self.report.as_ref().is_some_and(|r| r.applied >= rev)
    }

    /// The snap preview and the window it lies under.
    pub fn preview(&self) -> Option<&(Rect, String)> {
        self.preview.as_ref()
    }

    /// Whether something glides, so each frame plans again.
    pub fn moving(&self) -> bool {
        self.moving
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
                // One laid out at no size (hidden in the page) keeps the size it had; an overlay
                // not shown yet is made at the app's, which it covers once shown.
                Some(p) => Seat {
                    size: if p.width > 0.0 && p.height > 0.0 {
                        Some((p.width, p.height))
                    } else if p.layer == Layer::Overlay {
                        Some((report.width, report.height))
                    } else {
                        None
                    },
                    visible: p.shown && p.width > 0.0 && p.height > 0.0,
                },
                None => plan.seat(plugin),
            }
        };
        let steps = (self.surfaces).occluded(self.occluded, &self.docs, seat, self.scale);
        Outcome {
            steps,
            live: changed.then_some(live),
            wm: Vec::new(),
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

    /// A hidden window's time may have run out, or a window glides.
    pub fn tick(&mut self, now: Instant) -> Outcome {
        if self.moving {
            return self.replan(now);
        }
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
