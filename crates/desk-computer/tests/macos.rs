//! The real macOS computer, read only: permission status, displays, the window list, apps, a
//! screenshot of the main display and the frontmost app's tree when the OS allows them. Ignored by
//! default; run by hand on a Mac: `cargo test -p desk-computer --test macos -- --ignored`. Nothing
//! here posts input, performs an action, prompts or opens System Settings. Without a permission the
//! checks that need it assert the `permission_denied` instead and say so.
#![cfg(target_os = "macos")]

use desk_computer::ErrorCode;
use desk_computer::ax::{Budget, ElementRef};
use desk_computer::screen::{Capture, Target, WindowScope};

#[test]
#[ignore = "reads this Mac's TCC status"]
fn the_permission_status_is_reported() {
    let permissions = desk_computer::os().permissions().unwrap();
    eprintln!(
        "accessibility: {}, screen recording: {}, asked about: {}",
        permissions.accessibility,
        permissions.screen_recording,
        permissions
            .bundle_id
            .as_deref()
            .unwrap_or("the launching terminal")
    );
}

#[test]
#[ignore = "reads this Mac's displays and windows"]
fn the_displays_and_the_window_list_are_read() {
    let computer = desk_computer::os();
    let displays = computer.displays().unwrap();
    assert!(!displays.is_empty());
    assert!(displays[0].main, "the main display comes first");
    assert_eq!(displays.iter().filter(|d| d.main).count(), 1);
    for display in &displays {
        assert!(
            display.bounds.is_usable() && display.scale >= 1.0,
            "{display:?}"
        );
    }
    let windows = computer.windows(WindowScope::OnScreen).unwrap();
    assert!(!windows.is_empty(), "the menu bar is a window");
    assert!(windows.iter().all(|w| w.pid > 0 && w.on_screen));
    let all = computer.windows(WindowScope::All).unwrap();
    assert!(all.len() >= windows.len());
    let titled = windows.iter().filter(|w| w.title.is_some()).count();
    eprintln!(
        "{} displays ({}× main), {} windows on screen ({titled} titled), {} in all",
        displays.len(),
        displays[0].scale,
        windows.len(),
        all.len()
    );
    if !computer.permissions().unwrap().screen_recording {
        assert_eq!(titled, 0, "titles stay hidden without Screen Recording");
    }
}

#[test]
#[ignore = "reads this Mac's running apps"]
fn the_running_apps_are_listed() {
    let apps = desk_computer::os().apps().unwrap();
    assert!(
        apps.iter()
            .any(|a| a.bundle_id.as_deref() == Some("com.apple.finder"))
    );
    assert!(apps.iter().filter(|a| a.active).count() <= 1);
    eprintln!(
        "{} apps, {} regular",
        apps.len(),
        apps.iter().filter(|a| a.regular).count()
    );
}

#[test]
#[ignore = "captures this Mac's main display when Screen Recording is granted"]
fn a_screenshot_of_the_main_display() {
    let computer = desk_computer::os();
    let capture = Capture::of(Target::MainDisplay).fit(1280, 1280);
    if !computer.permissions().unwrap().screen_recording {
        let error = computer.screenshot(&capture).unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied);
        eprintln!("skipped the capture: {}", error.message);
        return;
    }
    let shot = computer.screenshot(&capture).unwrap();
    assert!(shot.png.starts_with(b"\x89PNG\r\n\x1a\n"));
    assert!(shot.width <= 1280 && shot.height <= 1280 && shot.width > 0);
    assert!(shot.scale > 0.0);
    eprintln!(
        "{}×{} px at {:.3} px/pt over {}, {} bytes",
        shot.width,
        shot.height,
        shot.scale,
        shot.bounds,
        shot.png.len()
    );
}

#[test]
#[ignore = "reads the frontmost app's interface when Accessibility is granted"]
fn the_frontmost_apps_tree_is_read() {
    let computer = desk_computer::os();
    if !computer.permissions().unwrap().accessibility {
        let error = computer.focused().unwrap_err();
        assert_eq!(error.code, ErrorCode::PermissionDenied);
        eprintln!("skipped the tree: {}", error.message);
        return;
    }
    let focus = computer.focused().unwrap();
    let tree = computer
        .tree(&ElementRef::app(focus.app.pid), Budget::new(3, 200))
        .unwrap();
    assert!(tree.nodes >= 1 && tree.nodes <= 200);
    assert_eq!(tree.root.element.role, "AXApplication");
    eprintln!(
        "{}: {} elements, truncated {}, focused window {:?}",
        focus.app.name,
        tree.nodes,
        tree.truncated,
        focus.window.and_then(|w| w.title)
    );
}
