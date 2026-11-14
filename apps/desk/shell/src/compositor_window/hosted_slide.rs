//! The desktop that left, while the one in front slides in (ADR 0222). The window manager draws
//! the desktop in front to the side of its place and brings it in (`desk_wm::interact::Slide`);
//! it no longer places the windows of the desktop that left. Those are the windows of the plan in
//! hand when the switch comes: they are kept as they were drawn, and drawn as one sheet a whole
//! app ahead of the desktop coming in (`draw_slide.rs`), from the textures their pages last
//! painted, until the slide ends. A window both desktops show (a plugin's that no layout places)
//! is on both sheets, as the one picture each desktop is.

use desk_wm::interact::Frame;
use desk_wm::{HostWindow, Plan};

use super::Hosted;

/// The windows of the desktop that left, and how far to the side they are drawn now.
#[derive(Debug, Default)]
pub struct Leaving {
    windows: Vec<HostWindow>,
    out: f64,
}

impl Leaving {
    /// Follow the window manager's `frame` from what was `kept`: a switch that slides keeps the
    /// windows drawn last (`plan`, still the desktop that left's) as the desktop that left,
    /// each frame of the slide moves them, and its end lets them go.
    pub(super) fn follow(
        kept: Option<Leaving>,
        frame: &Frame,
        plan: Option<&Plan>,
    ) -> Option<Leaving> {
        let (_, out) = frame.slide?;
        let mut leaving = kept;
        if frame.switched {
            let windows = (plan.iter().flat_map(|plan| plan.windows.iter()))
                .cloned()
                .map(|mut w| {
                    // The page's picture shows the desktop in front: nothing of it is this window's.
                    w.page_parts.clear();
                    w
                })
                .collect();
            leaving = Some(Leaving { windows, out });
        }
        leaving.map(|kept| Leaving { out, ..kept })
    }
}

impl Hosted {
    /// The windows of the desktop that left and how far to the side they are, while a switch slides.
    pub fn leaving(&self) -> Option<(&[HostWindow], f64)> {
        let leaving = self.leaving.as_ref()?;
        Some((&leaving.windows, leaving.out))
    }
}

#[cfg(test)]
mod tests {
    use std::time::Instant;

    use desk_wm::edits::Edit;
    use desk_wm::{Desk, Size};
    use serde_json::json;

    use super::Hosted;
    use crate::compositor_window::report::DeskReport;

    /// Notes and Mail on the desk, desktop 1 in front, drawn once.
    fn hosted() -> Hosted {
        let desk: Desk = serde_json::from_value(json!({ "desktop": "1",
            "adopted": [{ "id": "endue.notes", "title": "Notes", "slot": 0 },
                { "id": "endue.mail", "title": "Mail", "slot": 1 }] }))
        .unwrap();
        let report: DeskReport =
            serde_json::from_value(json!({ "seq": 1, "width": 1440, "height": 900 })).unwrap();
        let mut hosted = Hosted::new(1.0);
        let (w, h) = (1440.0, 900.0);
        hosted.wm.start(desk, Size { w, h });
        hosted.hold_clock(Some(0.0));
        hosted.apply(report, Instant::now());
        hosted
    }

    /// Draw again at `ms` on the window manager's clock.
    fn at(hosted: &mut Hosted, ms: f64) {
        hosted.hold_clock(Some(ms));
        hosted.replan(Instant::now());
    }

    #[test]
    fn the_desktop_that_left_is_kept_as_drawn_and_moves_a_whole_app_ahead_until_the_slide_ends() {
        let mut hosted = hosted();
        assert!(hosted.leaving().is_none(), "nothing slides at rest");
        let drawn: Vec<_> = (hosted.plan().unwrap().windows.iter())
            .map(|w| (w.id.clone(), w.rect))
            .collect();
        assert_eq!(drawn.len(), 2);
        let to = "2".into();
        hosted.wm.edit(1, &[Edit::SwitchTo { desktop: to }]);
        at(&mut hosted, 1000.0);
        let (windows, out) = hosted.leaving().expect("the switch slides");
        let kept: Vec<_> = windows.iter().map(|w| (w.id.clone(), w.rect)).collect();
        assert_eq!((kept, out), (drawn.clone(), 0.0));
        assert!(windows.iter().all(|w| w.page_parts.is_empty()));
        assert!(hosted.moving());

        // Half way: the same windows, to the left as the desktop coming in from the right is.
        at(&mut hosted, 1110.0);
        let (windows, out) = hosted.leaving().expect("still sliding");
        let kept: Vec<_> = windows.iter().map(|w| (w.id.clone(), w.rect)).collect();
        assert_eq!(kept, drawn);
        assert!(out < 0.0 && out > -1440.0, "{out}");

        at(&mut hosted, 1220.0);
        assert!(hosted.leaving().is_none());
        assert!(!hosted.moving());
    }
}
