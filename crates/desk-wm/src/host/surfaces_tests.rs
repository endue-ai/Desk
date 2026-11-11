//! A surface's pages follow its holder's count of them (W1): whatever the reports in between missed,
//! the steps leave one page live, the one the holder asked for last.

use super::{FrameDoc, FrameState, Seat, Step, Surfaces};

const HOST: &str = "main.endue-notes";

fn doc(state: FrameState, loads: u64, rev: u32) -> FrameDoc {
    FrameDoc {
        plugin: "endue.notes".into(),
        surface: HOST.into(),
        view: "main".into(),
        src: format!("desk-plugin://{HOST}/endue.notes/ui/index.html?v={rev}"),
        loads,
        state,
    }
}

/// A web host as the steps drive it: the page it shows, by the holder's count it was opened for.
#[derive(Default)]
struct Host {
    live: Option<u64>,
    opened: u32,
}

impl Host {
    fn run(&mut self, steps: &[Step], loads: u64) {
        for step in steps {
            match step {
                // A new browser, or the dead one's document again in a new renderer.
                Step::Create { .. } | Step::Wake { .. } => self.open(loads),
                // A live browser navigates: its page goes, a new one loads.
                Step::Load { .. } if self.live.is_some() => self.open(loads),
                Step::Sleep { .. } | Step::Destroy { .. } => self.live = None,
                _ => {}
            }
        }
    }

    fn open(&mut self, loads: u64) {
        self.live = Some(loads);
        self.opened += 1;
    }
}

/// The reports `seen` (state, the holder's count, the revision) in turn: after each, a live frame
/// has one live page, the one for the count reported, and a frame away has none.
fn follow(seen: &[(FrameState, u64, u32)]) -> (Surfaces, Host) {
    let mut surfaces = Surfaces::new();
    let mut host = Host::default();
    let seat = |_: &str| Seat {
        size: Some((640.0, 480.0)),
        visible: true,
    };
    for (i, &(state, loads, rev)) in seen.iter().enumerate() {
        let steps = surfaces.apply(&[doc(state, loads, rev)], seat, 2.0);
        host.run(&steps, loads);
        let want = (!state.away()).then_some(loads);
        assert_eq!(host.live, want, "report {i} of {seen:?}: {steps:?}");
        let again = surfaces.apply(&[doc(state, loads, rev)], seat, 2.0);
        assert!(again.is_empty(), "report {i} again: {again:?}");
    }
    (surfaces, host)
}

use FrameState::{Asleep, Live, Stopped};

#[test]
fn a_sleep_and_a_wake_between_two_reports_load_the_page_again() {
    // The holder took the frame away and put it back within one report interval: the reports
    // say only that it is live on its second page.
    let (_, host) = follow(&[(Live, 1, 1), (Live, 2, 1)]);
    assert_eq!(host.opened, 2, "the first page, then one new page");
    // Twice between two reports, or with a new revision as well: one new page all the same.
    let (_, host) = follow(&[(Live, 1, 1), (Live, 3, 1)]);
    assert_eq!(host.opened, 2);
    follow(&[(Live, 1, 1), (Live, 3, 2)]);
}

#[test]
fn a_sleep_and_a_wake_both_reported_close_the_page_and_open_a_new_one() {
    let (_, host) = follow(&[(Live, 1, 1), (Asleep, 1, 1), (Live, 2, 1)]);
    assert_eq!(host.opened, 2);
    // Woken and put to sleep again between two reports: it stays asleep, its page made once back.
    let (_, host) = follow(&[(Live, 1, 1), (Asleep, 1, 1), (Asleep, 2, 1), (Live, 3, 1)]);
    assert_eq!(host.opened, 2);
    // Stopped and reloaded by the person, reported or not.
    follow(&[(Live, 1, 1), (Stopped, 1, 1), (Live, 2, 1), (Live, 3, 1)]);
}

#[test]
fn a_death_still_waits_for_its_holder_and_a_new_revision_loads_once() {
    let mut surfaces = Surfaces::new();
    let mut host = Host::default();
    let seat = |_: &str| Seat {
        size: Some((640.0, 480.0)),
        visible: true,
    };
    host.run(&surfaces.apply(&[doc(Live, 1, 1)], seat, 2.0), 1);
    surfaces.died(HOST);
    host.live = None;
    // Nothing until its holder loads it again; then one wake, which loads it in a new renderer.
    assert!(surfaces.apply(&[doc(Live, 1, 1)], seat, 2.0).is_empty());
    let steps = surfaces.apply(&[doc(Live, 2, 1)], seat, 2.0);
    assert!(matches!(steps.as_slice(), [Step::Wake { .. }]), "{steps:?}");
    host.run(&steps, 2);
    assert_eq!(host.live, Some(2));
    // A new revision: one load.
    let steps = surfaces.apply(&[doc(Live, 3, 2)], seat, 2.0);
    assert!(matches!(steps.as_slice(), [Step::Load { .. }]), "{steps:?}");
}
