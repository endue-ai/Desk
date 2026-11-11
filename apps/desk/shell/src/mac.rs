//! macOS glue. Chromium expects the shared `NSApplication` to answer `isHandlingSendEvent` and
//! `setHandlingSendEvent:` (`CrAppProtocol`, `CrAppControlProtocol`) and to raise that flag while it
//! dispatches an event. winit owns the shared application and swizzles `sendEvent:` itself, so the
//! shell adds the two methods to the application's class and wraps winit's `sendEvent:` in turn,
//! the technique winit uses (`platform_impl/macos/app.rs`).
#![allow(unsafe_code)]

use std::cell::Cell;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, Ordering};

use objc2::ffi;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{msg_send, sel};
use objc2_app_kit::{NSApplication, NSAutoresizingMaskOptions, NSView};
use objc2_foundation::MainThreadMarker;

type SendEvent = extern "C-unwind" fn(&NSApplication, Sel, &AnyObject);

thread_local! {
    static ORIGINAL: Cell<Option<SendEvent>> = const { Cell::new(None) };
}

static HANDLING: AtomicBool = AtomicBool::new(false);

extern "C-unwind" fn is_handling_send_event(_app: &AnyObject, _sel: Sel) -> Bool {
    Bool::new(HANDLING.load(Ordering::Relaxed))
}

extern "C-unwind" fn set_handling_send_event(_app: &AnyObject, _sel: Sel, value: Bool) {
    HANDLING.store(value.as_bool(), Ordering::Relaxed);
}

extern "C-unwind" fn send_event(app: &NSApplication, sel: Sel, event: &AnyObject) {
    let was = HANDLING.swap(true, Ordering::Relaxed);
    if let Some(original) = ORIGINAL.with(Cell::get) {
        original(app, sel, event);
    }
    if !was {
        HANDLING.store(false, Ordering::Relaxed);
    }
}

/// Make the shared application speak Chromium's protocols. Call on the main thread after winit's
/// event loop exists and before `cef::initialize`.
pub fn adopt_cef_protocols(mtm: MainThreadMarker) {
    let app = NSApplication::sharedApplication(mtm);
    let class: &AnyClass = app.class();
    let class_ptr = class as *const AnyClass as *mut AnyClass;
    // SAFETY: the implementations match the selectors' signatures (`c@:`/`B@:` and `v@:B`), the
    // class is the live shared application's, and this runs once on the main thread.
    unsafe {
        let getter: Imp = std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel) -> Bool, Imp>(
            is_handling_send_event,
        );
        let setter: Imp = std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, Bool), Imp>(
            set_handling_send_event,
        );
        ffi::class_addMethod(
            class_ptr,
            sel!(isHandlingSendEvent),
            getter,
            c"B@:".as_ptr(),
        );
        ffi::class_addMethod(
            class_ptr,
            sel!(setHandlingSendEvent:),
            setter,
            c"v@:B".as_ptr(),
        );
        for name in [c"CrAppProtocol", c"CrAppControlProtocol", c"CefAppProtocol"] {
            let protocol = ffi::objc_getProtocol(name.as_ptr());
            if !protocol.is_null() {
                ffi::class_addProtocol(class_ptr, protocol);
            }
        }
        let Some(method) = class.instance_method(sel!(sendEvent:)) else {
            return;
        };
        let ours = std::mem::transmute::<SendEvent, Imp>(send_event);
        #[allow(unknown_lints, unpredictable_function_pointer_comparisons)]
        if method.implementation() == ours {
            return;
        }
        let original = method.set_implementation(ours);
        ORIGINAL.with(|cell| cell.set(Some(std::mem::transmute::<Imp, SendEvent>(original))));
    }
}

/// Take the browser's view out of its window: CEF destroys a browser when its view goes.
pub fn detach(view: *mut c_void) {
    if view.is_null() {
        return;
    }
    // SAFETY: `view` is the `NSView` CEF created for the browser (`GetWindowHandle`), alive until it
    // leaves its superview, which this asks for on the main thread.
    unsafe {
        let view = &*view.cast::<NSView>();
        view.removeFromSuperview();
    }
}

/// Let the browser's view follow its parent's size, so a window resize needs no call.
pub fn follow_parent_size(view: *mut c_void) {
    if view.is_null() {
        return;
    }
    // SAFETY: `view` is the `NSView` CEF created for the browser (`GetWindowHandle`), alive while
    // the browser is; retaining it here keeps it alive for the call.
    unsafe {
        let Some(view) = Retained::retain(view.cast::<NSView>()) else {
            return;
        };
        let mask = NSAutoresizingMaskOptions::ViewWidthSizable
            | NSAutoresizingMaskOptions::ViewHeightSizable;
        let _: () = msg_send![&view, setAutoresizingMask: mask];
    }
}

/// Hide or show the browser's view. Chromium takes a page whose view is hidden (or has a hidden
/// ancestor) for hidden, and stops its frames; a hidden window alone it does not (#147).
pub fn set_hidden(view: *mut c_void, hidden: bool) {
    if view.is_null() {
        return;
    }
    // SAFETY: `view` is the `NSView` CEF created for the browser (`GetWindowHandle`), alive while
    // the browser is; retaining it here keeps it alive for the call, made on the main thread.
    unsafe {
        let Some(view) = Retained::retain(view.cast::<NSView>()) else {
            return;
        };
        view.setHidden(hidden);
    }
}
