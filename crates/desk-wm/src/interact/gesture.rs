//! The window gestures (`surfaceInteractions` in `packages/runtime/src/surface/interactions.ts`,
//! `mountPan` in `shell/Pan.ts`): moving a window by its title bar, resizing it from one of its
//! eight grips, and Shift + drag panning the canvas. Each runs on one press (`drag.rs`) and reads
//! the desk as it is when the press becomes a drag.
//!
//! - A move takes the window with the pointer; a floating one stays inside the app. Dragged to an
//!   edge or a corner it aims at that part (`snap::Aim`, ADR 0128), and the drop snaps it there; a
//!   filled window comes off its fill as the drag starts, its own size again with the pointer at
//!   the same share of its width, its size gliding back (ADR 0132). A pinned window does not move.
//! - A resize moves the grabbed edges, the opposite ones anchored; a floating window's stop at the
//!   app's edges. It ends a fill where it is, the window in the mode it had before it filled, so a
//!   normal window snapped and resized is on the canvas again (#159 finding 10).
//! - A pan moves the canvas of the desktop it started on, and the normal windows with it.
//!
//! Escape, the app losing the focus or the window going cancels: the window is back where it was,
//! the canvas where it started.

use serde::{Deserialize, Serialize};

use crate::coordinates::{is_floating, screen_rect};
use crate::desk::Desk;
use crate::fill::{own_floating, unfilled};
use crate::geometry::{clamp_rect, screen_area};
use crate::math::round;
use crate::pan::PanDrag;
use crate::snap::Aim;
use crate::types::{Fill, Offset, Placement, Point, Rect, Size};

use super::drag::{Drag, Step};
use super::motion::{Easing, Motion};
use super::resize::{Grip, resize_rect};

/// What a press does, as the page found it under the pointer.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Kind {
    /// The window's title bar, away from its tools.
    Move { window: String },
    /// One of the window's grips.
    Resize { window: String, grip: Grip },
    /// Shift on the empty canvas or on a title bar.
    Pan,
}

/// What a gesture shows while it runs.
#[derive(Clone, Debug, PartialEq)]
pub enum Live {
    /// The window drawn at `rect` on screen, aiming at `aim` (a move's snap).
    Window {
        id: String,
        rect: Rect,
        aim: Option<Fill>,
    },
    /// The canvas of `desktop` panned to `pan`.
    Pan { desktop: String, pan: Offset },
}

/// How a gesture ended.
#[derive(Clone, Debug, PartialEq)]
pub enum Done {
    /// Dropped at `rect` on screen, kept in the mode `floating` says; out of any fill.
    Place {
        id: String,
        rect: Rect,
        floating: bool,
    },
    /// Dropped at `from` with the pointer at an edge or a corner: it fills `fill`.
    Snap { id: String, fill: Fill, from: Rect },
    /// The canvas of `desktop` at `pan`: where the drop left it, or where it started again.
    Pan { desktop: String, pan: Offset },
    /// Cancelled: the window is drawn where it was again.
    Back { id: String },
}

/// What a move or a resize read when the press became a drag.
#[derive(Clone, Debug, PartialEq)]
struct Window {
    start: Rect,
    /// The mode a drop keeps: the window's, or the one it had before it filled.
    floating: bool,
    aim: Option<Aim>,
    /// A filled window coming off its fill: its size glides back from the filled one, since `at`.
    unsnap: Option<(Size, f64)>,
}

/// One gesture, from its press.
#[derive(Clone, Debug, PartialEq)]
pub struct Gesture {
    pub kind: Kind,
    drag: Drag,
    window: Option<Window>,
    pan: Option<PanDrag>,
    /// What it showed last.
    live: Option<Live>,
}

impl Gesture {
    /// A press at `at` for `kind`.
    pub fn new(kind: Kind, at: Point) -> Gesture {
        Gesture {
            kind,
            drag: Drag::new(at),
            window: None,
            pan: None,
            live: None,
        }
    }

    /// The window it moves or resizes.
    pub fn window_id(&self) -> Option<&str> {
        match &self.kind {
            Kind::Move { window } | Kind::Resize { window, .. } => Some(window),
            Kind::Pan => None,
        }
    }

    /// Whether the press became a drag and still runs.
    pub fn dragging(&self) -> bool {
        self.drag.dragging()
    }

    /// Whether it ended.
    pub fn over(&self) -> bool {
        self.drag.phase() == super::drag::Phase::Over
    }

    pub fn live(&self) -> Option<&Live> {
        self.live.as_ref()
    }

    fn placement(&self, desk: &Desk) -> Option<Placement> {
        desk.window(self.window_id()?)
    }

    /// The press became a drag: read the window, drawn at `drawn`, or the canvas.
    fn begin(&mut self, desk: &Desk, drawn: Rect, screen: Size, now: f64) -> bool {
        let press = self.drag.from;
        let area = screen_area(screen.w, screen.h);
        match &self.kind {
            Kind::Pan => {
                let here = desk.here();
                self.pan = Some(PanDrag::start(desk.pan_of(&here), here));
                true
            }
            Kind::Resize { .. } => {
                let Some(p) = self.placement(desk) else {
                    return false;
                };
                self.window = Some(Window {
                    start: drawn,
                    floating: own_floating(&p),
                    aim: None,
                    unsnap: None,
                });
                true
            }
            Kind::Move { .. } => {
                let Some(p) = self.placement(desk).filter(|p| !p.pinned) else {
                    return false;
                };
                let mut window = Window {
                    start: drawn,
                    floating: is_floating(&p),
                    aim: Some(Aim::new(press, area)),
                    unsnap: None,
                };
                if p.restore.is_some() {
                    // Off its fill as the drag starts: its own size again, the pointer at the same
                    // share of its width, so the title bar stays under it.
                    let own = unfilled(&p);
                    let pan = desk.pan_of(&desk.here());
                    let back = screen_rect(&own, pan, screen.w, screen.h);
                    let share = if drawn.w > 0.0 {
                        (press.x - drawn.x) / drawn.w
                    } else {
                        0.0
                    };
                    let x = round(press.x - share * back.w);
                    window.start = Rect::new(x, drawn.y, back.w, back.h);
                    window.floating = is_floating(&own);
                    window.unsnap = Some((
                        Size {
                            w: drawn.w,
                            h: drawn.h,
                        },
                        now,
                    ));
                }
                self.window = Some(window);
                true
            }
        }
    }

    /// Where the window is with the pointer `dx`, `dy` from the press.
    fn rect(&self, dx: f64, dy: f64, screen: Size) -> Option<Rect> {
        let w = self.window.as_ref()?;
        let s = w.start;
        Some(match &self.kind {
            Kind::Resize { grip, .. } => {
                let bounds = w.floating.then(|| screen_area(screen.w, screen.h));
                resize_rect(s, *grip, dx, dy, bounds)
            }
            _ => {
                let r = Rect::new(s.x + dx, s.y + dy, s.w, s.h);
                if w.floating {
                    clamp_rect(r, screen.w, screen.h)
                } else {
                    r
                }
            }
        })
    }

    fn show(&mut self, desk: &Desk, dx: f64, dy: f64, at: Point, screen: Size) -> Option<Live> {
        let live = match &self.kind {
            Kind::Pan => {
                let pan = self.pan.as_ref()?.moved(dx, dy, &desk.here())?;
                Live::Pan {
                    desktop: desk.here(),
                    pan,
                }
            }
            Kind::Move { window } | Kind::Resize { window, .. } => {
                let rect = self.rect(dx, dy, screen)?;
                let area = screen_area(screen.w, screen.h);
                let aim = (self.window.as_mut()?.aim.as_mut()).and_then(|a| a.at_in(at, area));
                Live::Window {
                    id: window.clone(),
                    rect,
                    aim,
                }
            }
        };
        self.live = Some(live.clone());
        Some(live)
    }

    /// The pointer moved to `at`; the window is drawn at `drawn` now. What the gesture shows, once
    /// it is a drag; `None` while it is a press, or when it cannot start (the window is gone or
    /// pinned), which ends it.
    pub fn moved(
        &mut self,
        desk: &Desk,
        drawn: Option<Rect>,
        at: Point,
        screen: Size,
        now: f64,
    ) -> Option<Live> {
        match self.drag.moved(at) {
            Step::Nothing => None,
            Step::Started { dx, dy } => {
                let drawn = drawn.unwrap_or_default();
                if !self.begin(desk, drawn, screen, now) {
                    self.drag.cancel();
                    self.live = None;
                    return None;
                }
                self.show(desk, dx, dy, at, screen)
            }
            Step::Moved { dx, dy } => {
                if self.kind != Kind::Pan && self.placement(desk).is_none() {
                    return None;
                }
                self.show(desk, dx, dy, at, screen)
            }
        }
    }

    /// The button went up at `at`: what the drop does, when the press was a drag.
    pub fn released(&mut self, desk: &Desk, at: Point, screen: Size) -> Option<Done> {
        let (dx, dy) = self.drag.released(at)?;
        let live = self.show(desk, dx, dy, at, screen);
        self.live = None;
        match live? {
            Live::Pan { desktop, pan } => Some(Done::Pan { desktop, pan }),
            Live::Window { id, rect, aim } => {
                let floating = self.window.as_ref()?.floating;
                Some(match (aim, &self.kind) {
                    (Some(fill), Kind::Move { .. }) => Done::Snap {
                        id,
                        fill,
                        from: rect,
                    },
                    _ => Done::Place { id, rect, floating },
                })
            }
        }
    }

    /// Escape, the focus lost, the window gone: how it ends, when the press was a drag.
    pub fn cancel(&mut self) -> Option<Done> {
        if !self.drag.cancel() {
            return None;
        }
        self.live = None;
        match &self.kind {
            Kind::Pan => {
                let pan = self.pan.as_ref()?;
                let desktop = pan.desktop().to_owned();
                let back = pan.cancelled(&desktop)?;
                Some(Done::Pan { desktop, pan: back })
            }
            Kind::Move { window } | Kind::Resize { window, .. } => {
                Some(Done::Back { id: window.clone() })
            }
        }
    }

    /// The window's size while a filled one takes its own back: `rect` with its size on the way
    /// from the filled one, at `now`.
    pub fn sized(&self, rect: Rect, now: f64, motion: Motion) -> Rect {
        let Some((from, at)) = self.window.as_ref().and_then(|w| w.unsnap) else {
            return rect;
        };
        if motion.fast <= 0.0 {
            return rect;
        }
        let k = Easing::EASE_OUT.at(((now - at) / motion.fast).clamp(0.0, 1.0));
        Rect::new(
            rect.x,
            rect.y,
            from.w + (rect.w - from.w) * k,
            from.h + (rect.h - from.h) * k,
        )
    }

    /// Whether a filled window's size is still on its way back at `now`.
    pub fn sizing(&self, now: f64, motion: Motion) -> bool {
        self.dragging()
            && (self.window.as_ref().and_then(|w| w.unsnap))
                .is_some_and(|(_, at)| now - at < motion.fast)
    }
}
