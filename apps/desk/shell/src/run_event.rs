//! The app's run events from the OS (the Tauri shell's `run_event.rs`). On macOS, files opened with
//! the desk from Finder or the Dock (`application:openURLs:`) go to the open-files queue, and a click
//! on the Dock icon (`applicationShouldHandleReopen:hasVisibleWindows:`) shows the main window again,
//! since closing it only hides it. winit's application delegate answers neither, so the shell adds
//! the two methods to its class before the app finishes launching, the way `mac.rs` adds Chromium's.
//! Windows and Linux bring the desk back through a second start (`instance.rs`).

/// Whether a click on the Dock icon brings the main window back: when it is hidden (closed,
/// minimized or missing), or when macOS finds none of the desk's windows visible. With main in view
/// the click only activates the app, as it does for any Mac app.
pub fn reopen_shows_main(main_visible: bool, has_visible_windows: bool) -> bool {
    !main_visible || !has_visible_windows
}

#[cfg(target_os = "macos")]
pub use mac::listen;

/// Elsewhere the OS has no such events: a second start hands over its files.
#[cfg(not(target_os = "macos"))]
pub fn listen(_pump: &crate::pump::Pump) {}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
mod mac {
    use std::sync::OnceLock;

    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::{ffi, sel};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{MainThreadMarker, NSArray, NSURL};

    use crate::pump::Pump;

    static PUMP: OnceLock<Pump> = OnceLock::new();

    extern "C-unwind" fn open_urls(_: &AnyObject, _: Sel, _: &AnyObject, urls: &NSArray<NSURL>) {
        let paths: Vec<String> = urls
            .iter()
            .filter_map(|url| url.absoluteString())
            .filter_map(|text| crate::open_files::file_url(&text.to_string()))
            .collect();
        if let Some(pump) = PUMP.get() {
            pump.run(move |shell, _| shell.open_files(paths));
        }
    }

    extern "C-unwind" fn should_reopen(
        _: &AnyObject,
        _: Sel,
        _: &AnyObject,
        visible: Bool,
    ) -> Bool {
        if let Some(pump) = PUMP.get() {
            let visible = visible.as_bool();
            pump.run(move |shell, _| shell.reopen(visible));
        }
        Bool::YES
    }

    /// Answer Finder's and the Dock's events. Call on the main thread after winit's event loop
    /// exists (it sets the application's delegate) and before it runs.
    pub fn listen(pump: &Pump) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let _ = PUMP.set(pump.clone());
        let app = NSApplication::sharedApplication(mtm);
        let Some(delegate) = app.delegate() else {
            eprintln!(
                "endue Desk: no application delegate; Finder's and the Dock's events are lost"
            );
            return;
        };
        let class: &AnyClass = AnyObject::class(delegate.as_ref());
        let class = class as *const AnyClass as *mut AnyClass;
        // SAFETY: the implementations match the selectors' signatures (`v@:@@`, `B@:@B`), the class
        // is the live delegate's, and this runs once on the main thread before the app launches.
        unsafe {
            let open = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, &AnyObject, &NSArray<NSURL>),
                Imp,
            >(open_urls);
            let reopen = std::mem::transmute::<
                extern "C-unwind" fn(&AnyObject, Sel, &AnyObject, Bool) -> Bool,
                Imp,
            >(should_reopen);
            ffi::class_addMethod(class, sel!(application:openURLs:), open, c"v@:@@".as_ptr());
            ffi::class_addMethod(
                class,
                sel!(applicationShouldHandleReopen:hasVisibleWindows:),
                reopen,
                c"B@:@B".as_ptr(),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::reopen_shows_main;

    #[test]
    fn the_dock_icon_shows_main_when_it_is_hidden_or_nothing_is_visible() {
        // Closed (hidden) or minimized while another desk window, floating Eris, is in view.
        assert!(reopen_shows_main(false, true));
        // Closed and nothing of the desk's on screen.
        assert!(reopen_shows_main(false, false));
        // macOS finds no visible window although main says it is shown: show it anyway.
        assert!(reopen_shows_main(true, false));
        // Main in view: the click only activates the app.
        assert!(!reopen_shows_main(true, true));
    }
}
