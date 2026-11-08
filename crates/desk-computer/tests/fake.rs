//! `Control` over `FakeComputer`: every action recorded in order, scripted screens and trees, the
//! guard, the stop flag and the rate limit.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use desk_computer::apps::{AppOp, Launch};
use desk_computer::ax::{AxAction, Budget, ElementRef, Query, Setting};
use desk_computer::fake::{Call, FakeClock, FakeComputer};
use desk_computer::input::{Button, Event, Mouse};
use desk_computer::keys::{Chord, Key, Modifiers};
use desk_computer::screen::{Capture, Screenshot, Target};
use desk_computer::{Action, Clock, Computer, Control, ErrorCode, Point, RateLimit, Rect, Verdict};

mod support;
use support::{PID, allow, fake, notes, press};

#[test]
fn the_fake_records_every_action_in_order() {
    let fake = fake();
    let control = Control::new(fake.clone(), allow);
    let at = Point::new(100.0, 200.0);
    let save = ElementRef::new(PID, vec![0, 1]).expecting("AXButton");
    let field = ElementRef::new(PID, vec![0, 0]);

    let click = control
        .mouse(Mouse::Click {
            at,
            button: Button::Left,
            count: 2,
        })
        .unwrap();
    assert_eq!(click.events, 5);
    assert_eq!(click.summary, "double-click left at (100, 200): 5 events");
    control.key(Chord::parse("cmd+s").unwrap()).unwrap();
    control.text("안녕\n").unwrap();
    let pressed = control
        .act(Action::Perform {
            element: save.clone(),
            action: AxAction::Press,
        })
        .unwrap();
    assert_eq!(pressed.element.unwrap().title.as_deref(), Some("Save"));
    let setting = Setting::Value("hello".into());
    control
        .act(Action::Set {
            element: field.clone(),
            setting: setting.clone(),
        })
        .unwrap();
    let launched = control
        .act(Action::Launch(Launch::BundleId(
            "com.apple.TextEdit".into(),
        )))
        .unwrap();
    let textedit = launched.app.unwrap();
    assert!(textedit.active);
    control
        .act(Action::App {
            pid: PID,
            op: AppOp::Hide,
        })
        .unwrap();

    let cmd = Modifiers {
        command: true,
        ..Modifiers::default()
    };
    let none = Modifiers::default();
    let mut expected = vec![
        Call::Post(Event::Move { to: at }),
        Call::Post(Event::Down {
            at,
            button: Button::Left,
            clicks: 1,
        }),
        Call::Post(Event::Up {
            at,
            button: Button::Left,
            clicks: 1,
        }),
        Call::Post(Event::Down {
            at,
            button: Button::Left,
            clicks: 2,
        }),
        Call::Post(Event::Up {
            at,
            button: Button::Left,
            clicks: 2,
        }),
        Call::Post(Event::KeyDown {
            key: Key::Command,
            modifiers: cmd,
        }),
    ];
    expected.extend(press(Key::Char('s'), cmd).map(Call::Post));
    expected.push(Call::Post(Event::KeyUp {
        key: Key::Command,
        modifiers: none,
    }));
    expected.push(Call::Post(Event::Text {
        text: "안녕".into(),
    }));
    expected.extend(press(Key::Return, none).map(Call::Post));
    expected.extend([
        Call::Perform(save, AxAction::Press),
        Call::Set(field, setting),
        Call::Launch(Launch::BundleId("com.apple.TextEdit".into())),
        Call::App(PID, AppOp::Hide),
    ]);
    assert_eq!(fake.acts(), expected);
    assert_eq!(fake.calls(), expected, "reads were not asked for");
    assert_eq!(fake.typed(), "안녕\n");
    assert_eq!(fake.pointer(), at);
    let running = fake.running();
    assert!(running.iter().any(|a| a.pid == textedit.pid && a.active));
    assert!(running.iter().any(|a| a.pid == PID && a.hidden));
}

#[test]
fn screenshots_and_ax_trees_are_scripted() {
    let shot = Screenshot::solid(Rect::new(0.0, 0.0, 4.0, 3.0), 2.0, [10, 20, 30, 255]).unwrap();
    assert_eq!((shot.width, shot.height, shot.scale), (8, 6, 2.0));
    assert!(shot.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    let fake = Arc::new(
        FakeComputer::new()
            .with_tree(PID, notes())
            .with_screenshot(Target::MainDisplay, shot.clone()),
    );
    assert_eq!(
        fake.screenshot(&Capture::of(Target::MainDisplay)).unwrap(),
        shot
    );
    let unscripted = fake
        .screenshot(&Capture::of(Target::Window(7)))
        .unwrap_err();
    assert_eq!(unscripted.code, ErrorCode::NotFound);

    let tree = fake.tree(&ElementRef::app(PID), Budget::default()).unwrap();
    assert_eq!((tree.pid, tree.nodes, tree.truncated), (PID, 4, false));
    let window = &tree.root.children[0];
    assert_eq!(window.element.title.as_deref(), Some("Untitled"));
    assert_eq!(window.children[1].element.path, vec![0, 1]);
    let found = fake
        .find(
            &ElementRef::app(PID),
            &Query::any().role("button").title("save"),
            Budget::default(),
        )
        .unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(
        found[0].reference(PID),
        ElementRef::new(PID, vec![0, 1]).expecting("AXButton")
    );

    // A set changes the scripted tree; a stale reference is refused.
    let control = Control::new(fake.clone(), allow);
    let field = ElementRef::new(PID, vec![0, 0]).expecting("AXTextArea");
    control
        .act(Action::Set {
            element: field,
            setting: Setting::Value("메모".into()),
        })
        .unwrap();
    let tree = fake
        .tree(&ElementRef::new(PID, vec![0]), Budget::default())
        .unwrap();
    assert_eq!(tree.root.children[0].element.value.as_deref(), Some("메모"));
    let stale = ElementRef::new(PID, vec![0, 0]).expecting("AXButton");
    let error = control
        .act(Action::Perform {
            element: stale,
            action: AxAction::Press,
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::NotFound);
}

#[test]
fn the_guard_refusing_an_action_stops_it() {
    let fake = fake();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let guard = {
        let seen = seen.clone();
        move |action: &Action| {
            seen.lock().unwrap().push(action.clone());
            match action {
                Action::Text(text) if text.contains("password") => {
                    Verdict::Refuse("the person said no".into())
                }
                Action::App {
                    op: AppOp::Quit, ..
                } => Verdict::Refuse("not now".into()),
                _ => Verdict::Allow,
            }
        }
    };
    let control = Control::new(fake.clone(), guard);

    let error = control.text("my password is hunter2").unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(
        error.message.contains("the person said no"),
        "{}",
        error.message
    );
    let error = control
        .act(Action::App {
            pid: PID,
            op: AppOp::Quit,
        })
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::PermissionDenied);
    assert!(
        fake.acts().is_empty(),
        "nothing refused reached the computer"
    );
    assert_eq!(fake.running().len(), 1);

    control.text("ok").unwrap();
    assert_eq!(fake.typed(), "ok");
    assert_eq!(
        seen.lock().unwrap().len(),
        3,
        "the guard saw each action once"
    );
    // An action that cannot run is refused before the guard is asked.
    let error = control.text("").unwrap_err();
    assert_eq!(error.code, ErrorCode::InvalidParams);
    assert_eq!(seen.lock().unwrap().len(), 3);
}

#[test]
fn the_stop_flag_aborts_the_queued_input() {
    let fake = fake();
    // 20 events a second, one at a time: the first action takes about two seconds.
    let control = Arc::new(Control::new(fake.clone(), allow).with_rate(RateLimit::new(20, 1)));
    let long = "a\t".repeat(20);
    let first = {
        let control = control.clone();
        thread::spawn(move || control.text(long))
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while fake.posted().is_empty() {
        assert!(Instant::now() < deadline, "the first action never started");
        thread::sleep(Duration::from_millis(5));
    }
    let started = Arc::new(AtomicUsize::new(0));
    let queued: Vec<_> = (0..2)
        .map(|_| {
            let (control, started) = (control.clone(), started.clone());
            thread::spawn(move || {
                started.fetch_add(1, Ordering::SeqCst);
                control.text("queued")
            })
        })
        .collect();
    while started.load(Ordering::SeqCst) < 2 {
        thread::sleep(Duration::from_millis(1));
    }
    thread::sleep(Duration::from_millis(100));
    let raised = Instant::now();
    control.stop_flag().raise();

    let first = first.join().unwrap().unwrap_err();
    assert_eq!(first.code, ErrorCode::Cancelled);
    assert!(
        raised.elapsed() < Duration::from_secs(1),
        "the stop took {:?}",
        raised.elapsed()
    );
    for queued in queued {
        assert_eq!(
            queued.join().unwrap().unwrap_err().code,
            ErrorCode::Cancelled
        );
    }
    let posted = fake.posted();
    assert!(posted.len() < 60, "{} of 60 events went out", posted.len());
    assert!(!fake.typed().contains("queued"));
    // The Tab the first action may have pressed when it stopped was released.
    let downs = posted
        .iter()
        .filter(|e| matches!(e, Event::KeyDown { .. }))
        .count();
    let ups = posted
        .iter()
        .filter(|e| matches!(e, Event::KeyUp { .. }))
        .count();
    assert_eq!(downs, ups);
}

#[test]
fn the_rate_limit_holds() {
    let clock = Arc::new(FakeClock::new());
    let fake = Arc::new(
        FakeComputer::new()
            .with_tree(PID, notes())
            .with_clock(clock.clone()),
    );
    let control = Control::new(fake.clone(), allow)
        .with_clock(clock.clone())
        .with_rate(RateLimit::new(10, 3));

    // Thirteen events: a move, a press, a 10-step drag and the release.
    let drag = control
        .mouse(Mouse::Drag {
            from: Point::new(0.0, 0.0),
            to: Point::new(150.0, 0.0),
        })
        .unwrap();
    assert_eq!(drag.events, 13);
    let times: Vec<Duration> = fake.timeline().into_iter().map(|(at, _)| at).collect();
    assert_eq!(times.len(), 13);
    // Three at once, then one every 100 ms.
    let ms = |d: &Duration| d.as_secs_f64() * 1000.0;
    for (index, at) in times.iter().enumerate() {
        let earliest = index.saturating_sub(2) as f64 * 100.0;
        assert!(ms(at) >= earliest - 0.01, "event {index} at {} ms", ms(at));
        assert!(
            ms(at) <= earliest + 1.0,
            "event {index} waited too long: {} ms",
            ms(at)
        );
    }
    // A pause refills the burst, never more.
    clock.advance(Duration::from_secs(10));
    let before = clock.now();
    control.text("a\tb").unwrap();
    let last = fake.timeline().last().unwrap().0;
    assert!(
        ms(&(last - before)) >= 99.99,
        "four events, burst of three: {:?}",
        last - before
    );
}
