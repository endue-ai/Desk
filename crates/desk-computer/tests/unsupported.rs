//! Off macOS, `os()` answers `unsupported` for every call, through `Control` too.
#![cfg(not(target_os = "macos"))]

use desk_computer::ax::{Budget, ElementRef, Query};
use desk_computer::permissions::Permission;
use desk_computer::screen::{Capture, Target, WindowScope};
use desk_computer::{Action, Control, Error, ErrorCode, Verdict};

#[test]
fn every_call_is_unsupported_off_macos() {
    let computer = desk_computer::os();
    let app = ElementRef::app(1);
    let calls: Vec<Option<Error>> = vec![
        computer.permissions().err(),
        computer.request(Permission::Accessibility).err(),
        computer.open_settings(Permission::ScreenRecording).err(),
        computer.displays().err(),
        computer.windows(WindowScope::All).err(),
        computer.screenshot(&Capture::of(Target::MainDisplay)).err(),
        computer.focused().err(),
        computer.tree(&app, Budget::default()).err(),
        computer.find(&app, &Query::any(), Budget::default()).err(),
        computer.apps().err(),
    ];
    for (index, error) in calls.into_iter().enumerate() {
        assert_eq!(
            error.map(|e| e.code),
            Some(ErrorCode::Unsupported),
            "call {index}"
        );
    }
    let control = Control::new(computer, |_: &Action| Verdict::Allow);
    assert_eq!(control.text("hi").unwrap_err().code, ErrorCode::Unsupported);
}
