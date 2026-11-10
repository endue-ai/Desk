//! A web surface's lifecycle (`specs/surface/v0/lifecycle.md`) as the web host runs it: what each
//! compositor message does to an off-screen browser, apart from CEF so it is tested alone. A hidden
//! surface's browser is told `WasHidden` and paints nothing; a sleeping one has no browser, so its
//! renderer exits; a dead one keeps its browser, which a wake loads again in a new renderer.

use cef::TerminationStatus;
use desk_surface::generated::{CompositorMessage, SurfaceDeathReason};

/// Where a surface is in its lifecycle.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    /// A browser renders it; `hidden` says whether it was told `WasHidden`.
    Live { hidden: bool },
    /// No browser: its renderer may exit; its last frame stays with the compositor.
    Asleep { hidden: bool },
    /// Its renderer ended without being asked; the browser waits for a wake.
    Dead { hidden: bool },
    /// Destroyed: its browser closes and nothing follows.
    Gone,
}

/// What the host does to the surface's browser.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    /// Make a browser (hidden or not) at the surface's document.
    Open { hidden: bool },
    /// Lay out again at the stored size and scale.
    Resize,
    /// `WasHidden(true)` or `WasHidden(false)` and a repaint.
    Hide(bool),
    /// Load the document again in the dead browser (a new renderer).
    Restart,
    /// The most frames per second.
    Pace(u32),
    /// Close the browser.
    Close,
}

impl State {
    pub fn hidden(self) -> bool {
        match self {
            State::Live { hidden } | State::Asleep { hidden } | State::Dead { hidden } => hidden,
            State::Gone => true,
        }
    }

    /// The renderer died: only a live surface dies (a sleeping one's exit is not a death).
    pub fn died(self) -> State {
        match self {
            State::Live { hidden } => State::Dead { hidden },
            other => other,
        }
    }
}

/// The state after `message` and what to do; `None` is a surface not created yet.
pub fn step(state: Option<State>, message: &CompositorMessage) -> (Option<State>, Vec<Action>) {
    use CompositorMessage as M;
    match (state, message) {
        (None | Some(State::Gone), M::SurfaceCreate(create)) => {
            let hidden = create.hidden == Some(true);
            (Some(State::Live { hidden }), vec![Action::Open { hidden }])
        }
        (None, _) => (None, vec![]),
        (Some(State::Gone), _) => (Some(State::Gone), vec![]),
        (Some(_), M::SurfaceDestroy(_)) => (Some(State::Gone), vec![Action::Close]),
        (Some(s @ State::Live { .. }), M::SurfaceResize(_)) => (Some(s), vec![Action::Resize]),
        (Some(State::Live { hidden: true }), M::SurfaceShow(_)) => (
            Some(State::Live { hidden: false }),
            vec![Action::Hide(false)],
        ),
        (Some(State::Live { hidden: false }), M::SurfaceHide(_)) => {
            (Some(State::Live { hidden: true }), vec![Action::Hide(true)])
        }
        (Some(State::Asleep { .. }), M::SurfaceShow(_)) => {
            (Some(State::Asleep { hidden: false }), vec![])
        }
        (Some(State::Asleep { .. }), M::SurfaceHide(_)) => {
            (Some(State::Asleep { hidden: true }), vec![])
        }
        (Some(State::Dead { .. }), M::SurfaceShow(_)) => {
            (Some(State::Dead { hidden: false }), vec![])
        }
        (Some(State::Dead { .. }), M::SurfaceHide(_)) => {
            (Some(State::Dead { hidden: true }), vec![])
        }
        (Some(State::Live { hidden } | State::Dead { hidden }), M::SurfaceSleep(_)) => {
            (Some(State::Asleep { hidden }), vec![Action::Close])
        }
        (Some(State::Asleep { hidden }), M::SurfaceWake(_)) => {
            (Some(State::Live { hidden }), vec![Action::Open { hidden }])
        }
        (Some(State::Dead { hidden }), M::SurfaceWake(_)) => (
            Some(State::Live { hidden }),
            vec![Action::Resize, Action::Restart],
        ),
        (Some(s @ State::Live { .. }), M::SurfaceWake(_)) => (Some(s), vec![Action::Resize]),
        (Some(s), M::SurfacePace(pace)) => {
            (Some(s), vec![Action::Pace(pace.fps.clamp(1, 240) as u32)])
        }
        // Releases need nothing (frames are copied before the paint returns, or the compositor owns
        // them); input is #56's.
        (Some(s), _) => (Some(s), vec![]),
    }
}

/// Why CEF says a renderer ended, as the protocol says it.
pub fn death_reason(status: TerminationStatus) -> SurfaceDeathReason {
    if status == TerminationStatus::PROCESS_WAS_KILLED {
        SurfaceDeathReason::Killed
    } else if status == TerminationStatus::PROCESS_OOM {
        SurfaceDeathReason::OutOfMemory
    } else if status == TerminationStatus::LAUNCH_FAILED {
        SurfaceDeathReason::LaunchFailed
    } else if status == TerminationStatus::ABNORMAL_TERMINATION {
        SurfaceDeathReason::Exited
    } else {
        SurfaceDeathReason::Crashed
    }
}

/// The surface a compositor message is about.
pub fn surface_of(message: &CompositorMessage) -> Option<String> {
    let value = serde_json::to_value(message).ok()?;
    value.get("surface")?.as_str().map(str::to_owned)
}

/// The size and scale a lifecycle message brings.
pub fn size_of(message: &CompositorMessage) -> Option<((u32, u32), f32)> {
    let (size, scale) = match message {
        CompositorMessage::SurfaceCreate(m) => (&m.size, m.scale),
        CompositorMessage::SurfaceResize(m) => (&m.size, m.scale),
        CompositorMessage::SurfaceWake(m) => (&m.size, m.scale),
        _ => return None,
    };
    Some(((size.width as u32, size.height as u32), scale as f32))
}

#[cfg(test)]
mod tests {
    use super::{Action, State, death_reason, step};
    use cef::TerminationStatus;
    use desk_surface::generated::{CompositorMessage, SurfaceDeathReason};
    use serde_json::json;

    fn message(value: serde_json::Value) -> CompositorMessage {
        serde_json::from_value(value).unwrap()
    }

    fn of(kind: &str) -> CompositorMessage {
        let size = json!({ "width": 400, "height": 300 });
        match kind {
            "create" => message(
                json!({ "type": "create", "surface": "s", "plugin": "a.b", "view": "main", "size": size, "scale": 2, "format": "bgra8" }),
            ),
            "create-hidden" => message(
                json!({ "type": "create", "surface": "s", "plugin": "a.b", "view": "main", "size": size, "scale": 2, "format": "bgra8", "hidden": true }),
            ),
            "resize" | "wake" => {
                message(json!({ "type": kind, "surface": "s", "size": size, "scale": 1 }))
            }
            "pace" => message(json!({ "type": "pace", "surface": "s", "fps": 500 })),
            other => message(json!({ "type": other, "surface": "s" })),
        }
    }

    #[test]
    fn hide_and_show_tell_the_browser_and_only_change_a_live_one() {
        let (state, actions) = step(None, &of("create"));
        assert_eq!(
            (state, actions),
            (
                Some(State::Live { hidden: false }),
                vec![Action::Open { hidden: false }]
            )
        );
        let (state, actions) = step(state, &of("hide"));
        assert_eq!(
            (state, actions),
            (Some(State::Live { hidden: true }), vec![Action::Hide(true)])
        );
        assert_eq!(step(state, &of("hide")).1, vec![], "hidden already");
        let (state, actions) = step(state, &of("show"));
        assert_eq!(
            (state, actions),
            (
                Some(State::Live { hidden: false }),
                vec![Action::Hide(false)]
            )
        );
        assert_eq!(
            step(None, &of("create-hidden")).1,
            vec![Action::Open { hidden: true }]
        );
        assert_eq!(
            step(None, &of("show")),
            (None, vec![]),
            "nothing before create"
        );
    }

    #[test]
    fn sleep_closes_the_browser_and_wake_opens_a_new_one() {
        let live = Some(State::Live { hidden: false });
        let (asleep, actions) = step(live, &of("sleep"));
        assert_eq!(
            (asleep, actions),
            (Some(State::Asleep { hidden: false }), vec![Action::Close])
        );
        assert_eq!(
            step(asleep, &of("resize")).1,
            vec![],
            "a sleeping surface keeps the size for its wake"
        );
        let (woken, actions) = step(asleep, &of("wake"));
        assert_eq!(
            (woken, actions),
            (live, vec![Action::Open { hidden: false }])
        );
        assert_eq!(step(live, &of("pace")).1, vec![Action::Pace(240)]);
    }

    #[test]
    fn a_death_waits_for_a_wake_that_loads_again_and_destroy_ends_everything() {
        let dead = State::Live { hidden: true }.died();
        assert_eq!(dead, State::Dead { hidden: true });
        assert_eq!(
            State::Asleep { hidden: false }.died(),
            State::Asleep { hidden: false },
            "an exit asleep is no death"
        );
        let (woken, actions) = step(Some(dead), &of("wake"));
        assert_eq!(
            (woken, actions),
            (
                Some(State::Live { hidden: true }),
                vec![Action::Resize, Action::Restart]
            )
        );
        assert_eq!(step(Some(dead), &of("sleep")).1, vec![Action::Close]);
        let (gone, actions) = step(woken, &of("destroy"));
        assert_eq!((gone, actions), (Some(State::Gone), vec![Action::Close]));
        assert_eq!(step(gone, &of("wake")).1, vec![]);
        assert_eq!(
            step(gone, &of("create")).1,
            vec![Action::Open { hidden: false }],
            "made again"
        );
    }

    #[test]
    fn cef_termination_statuses_name_the_protocols_reasons() {
        assert_eq!(
            death_reason(TerminationStatus::PROCESS_WAS_KILLED),
            SurfaceDeathReason::Killed
        );
        assert_eq!(
            death_reason(TerminationStatus::PROCESS_CRASHED),
            SurfaceDeathReason::Crashed
        );
        assert_eq!(
            death_reason(TerminationStatus::PROCESS_OOM),
            SurfaceDeathReason::OutOfMemory
        );
        assert_eq!(
            death_reason(TerminationStatus::LAUNCH_FAILED),
            SurfaceDeathReason::LaunchFailed
        );
        assert_eq!(
            death_reason(TerminationStatus::ABNORMAL_TERMINATION),
            SurfaceDeathReason::Exited
        );
        assert_eq!(
            death_reason(TerminationStatus::INTEGRITY_FAILURE),
            SurfaceDeathReason::Crashed
        );
    }
}
