//! What `tests/host.rs` builds its looks from: the plan of a 1440×900 app, a plugin's frame as
//! the runtime reports it, the steps' kinds, and a holder that carries the budget's decisions
//! out as the runtime does (ADR 0156).

use std::collections::{BTreeMap, BTreeSet};

use desk_wm::{Desk, FrameDoc, FrameState, LiveBudget, Plan, Step, Surfaces, TopChrome, Unseen};

pub const W: f64 = 1440.0;
pub const H: f64 = 900.0;

pub fn plan(desk: &Desk) -> Plan {
    desk.host_plan(W, H, TopChrome::default(), &Unseen)
}

/// The surface host the runtime names a plugin's surface by (`<surface>.<plugin label>`).
pub fn host_of(plugin: &str) -> String {
    format!("main.{}", plugin.replace('.', "-"))
}

pub fn doc(plugin: &str, state: FrameState) -> FrameDoc {
    FrameDoc {
        plugin: plugin.into(),
        surface: host_of(plugin),
        view: "main".into(),
        src: format!("desk-plugin://{}/index.html", host_of(plugin)),
        loads: 1,
        state,
    }
}

pub fn kinds(steps: &[Step]) -> Vec<&'static str> {
    steps
        .iter()
        .map(|s| match s {
            Step::Load { .. } => "load",
            Step::Create { .. } => "create",
            Step::Resize { .. } => "resize",
            Step::Show { .. } => "show",
            Step::Hide { .. } => "hide",
            Step::Sleep { .. } => "sleep",
            Step::Wake { .. } => "wake",
            Step::Destroy { .. } => "destroy",
        })
        .collect()
}

/// Apply the frames as the runtime reports them, seated by the plan.
pub fn look(surfaces: &mut Surfaces, desk: &Desk, frames: &[FrameDoc]) -> Vec<Step> {
    let p = plan(desk);
    surfaces.apply(frames, |plugin| p.seat(plugin), 2.0)
}

/// The runtime carrying out the budget's decisions (ADR 0156): it asks a plugin for its
/// `desk:state` before taking its frame away, and hands it back on the next hello.
#[derive(Default)]
pub struct Holder {
    pub counts: BTreeMap<String, u32>,
    kept: BTreeMap<String, u32>,
    pub asleep: BTreeSet<String>,
}

impl Holder {
    fn sleep(&mut self, id: &str) {
        if self.asleep.insert(id.to_string()) {
            let count = self.counts.remove(id).unwrap_or(0);
            self.kept.insert(id.to_string(), count);
        }
    }

    fn wake(&mut self, id: &str) {
        if self.asleep.remove(id) {
            let count = self.kept.remove(id).unwrap_or(0);
            self.counts.insert(id.to_string(), count);
        }
    }

    fn frames(&self, ids: &[String]) -> Vec<FrameDoc> {
        (ids.iter())
            .map(|id| {
                let state = if self.asleep.contains(id) {
                    FrameState::Asleep
                } else {
                    FrameState::Live
                };
                doc(id, state)
            })
            .collect()
    }
}

/// One look: the budget decides from the plan, the holder carries it out, the surfaces follow.
pub fn settle(
    desk: &Desk,
    budget: &mut LiveBudget,
    holder: &mut Holder,
    surfaces: &mut Surfaces,
    ids: &[String],
) -> Vec<Step> {
    let p = plan(desk);
    let d = budget.decide(&p.shown, p.focused_plugin.as_deref(), 8, 0.0, 0.0);
    for id in &d.sleep {
        holder.sleep(id);
    }
    for id in &d.wake {
        holder.wake(id);
    }
    for id in ids {
        budget.reported(id, holder.asleep.contains(id));
    }
    surfaces.apply(&holder.frames(ids), |id| p.seat(id), 2.0)
}

pub fn live(surfaces: &Surfaces) -> Vec<String> {
    let mut all: Vec<String> = (surfaces.made().into_iter())
        .filter(|(_, _, asleep)| !asleep)
        .map(|(_, plugin, _)| plugin)
        .collect();
    all.sort();
    all
}
