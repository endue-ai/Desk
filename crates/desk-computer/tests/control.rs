//! `Control` over `FakeComputer`: the OS permissions it keeps, and a stop that lands part-way
//! through an action.

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use desk_computer::fake::{FakeClock, FakeComputer};
use desk_computer::input::Event;
use desk_computer::keys::{Chord, Key, Modifiers};
use desk_computer::permissions::Permission;
use desk_computer::screen::{Capture, Target};
use desk_computer::{Computer, Control, ErrorCode, RateLimit, StopFlag};

mod support;
use support::{PID, StopOnSleep, allow, fake, notes};

#[test]
fn the_os_permissions_hold_in_the_fake() {
    let fake = Arc::new(
        FakeComputer::new()
            .with_tree(PID, notes())
            .with_permissions(false, false),
    );
    let control = Control::new(fake.clone(), allow);
    let error = control.text("hi").unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(
        error.message.contains("Privacy_Accessibility"),
        "{}",
        error.message
    );
    let error = fake
        .screenshot(&Capture::of(Target::MainDisplay))
        .unwrap_err();
    assert!(
        error.message.contains("Privacy_ScreenCapture"),
        "{}",
        error.message
    );
    assert!(fake.request(Permission::Accessibility).unwrap());
    assert!(fake.permissions().unwrap().accessibility);
    assert!(!fake.permissions().unwrap().screen_recording);
}

#[test]
fn the_stop_flag_aborts_an_action_and_releases_what_it_held() {
    let fake = fake();
    let stop = StopFlag::new();
    let clock = Arc::new(StopOnSleep {
        clock: FakeClock::new(),
        stop: stop.clone(),
        armed: AtomicBool::new(true),
    });
    let control = Control::new(fake.clone(), allow)
        .with_stop(stop.clone())
        .with_clock(clock)
        .with_rate(RateLimit::new(10, 2));

    // cmd+shift+t is six events; two go out at once, the third waits and is stopped.
    let error = control
        .key(Chord::parse("cmd+shift+t").unwrap())
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert!(
        error.message.contains("stopped after 2 of 6 events"),
        "{}",
        error.message
    );
    let none = Modifiers::default();
    let cmd = Modifiers {
        command: true,
        ..none
    };
    let cmd_shift = Modifiers { shift: true, ..cmd };
    assert_eq!(
        fake.posted(),
        vec![
            Event::KeyDown {
                key: Key::Shift,
                modifiers: Modifiers {
                    shift: true,
                    ..none
                }
            },
            Event::KeyDown {
                key: Key::Command,
                modifiers: cmd_shift
            },
            // Released again, newest first, so no modifier stays held.
            Event::KeyUp {
                key: Key::Command,
                modifiers: none
            },
            Event::KeyUp {
                key: Key::Shift,
                modifiers: none
            },
        ]
    );

    // While it is raised nothing new runs; cleared, input goes out again.
    let error = control.text("later").unwrap_err();
    assert_eq!(error.code, ErrorCode::Cancelled);
    assert_eq!(fake.posted().len(), 4);
    stop.clear();
    control.text("later").unwrap();
    assert_eq!(fake.typed(), "later");
}
