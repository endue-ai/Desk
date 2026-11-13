//! The island as a non-activating panel on macOS (ADR 0204). winit makes an `NSWindow`; a press on a
//! window of an inactive app activates that app, so the app in front would lose the keys and its
//! menu bar. An `NSPanel` with `NSWindowStyleMaskNonactivatingPanel` takes the keys when pressed and
//! leaves the app in front active, and only such a panel shows over another app's full-screen Space.
//! winit has no panel, and a window's class cannot change once it exists (AppKit and winit observe
//! it, and key-value observing keeps the class it saw). So while winit makes the island's window,
//! `WinitWindow`'s allocation hands out an instance of the shell's panel class instead, an `NSPanel`
//! that may become key and never main and keeps the non-activating style whatever style winit sets,
//! and `NSWindow`'s initializer gives it that style from the start: a panel given it later still
//! activates the app when pressed. Both go back as they were once the window exists. winit treats
//! the panel as its own window: safe only while `WinitWindow` and the panel add nothing to an
//! `NSWindow`'s memory, which is checked first; otherwise the island is winit's floating window.
//! Elsewhere winit's always-on-top window is what there is.

use winit::window::Window;

/// Run `make`, winit making the island's window, so that the window it makes is a panel.
pub fn made_as_panel<T>(make: impl FnOnce() -> T) -> T {
    #[cfg(target_os = "macos")]
    return mac::made_as_panel(make);
    #[cfg(not(target_os = "macos"))]
    make()
}

/// Give the island the keys without making the desk the active app (Option+Enter); elsewhere the
/// window takes the focus as any does.
pub fn make_key(window: &Window) {
    #[cfg(target_os = "macos")]
    if let Some(ns_window) = crate::float::mac::ns_window(window) {
        ns_window.makeKeyAndOrderFront(None);
        return;
    }
    window.focus_window();
}

/// Give the keys back to the app in front (Escape): the panel leaves the screen and comes back at
/// once, no longer key. Elsewhere the OS decides where the focus goes.
pub fn give_back(window: &Window) {
    #[cfg(target_os = "macos")]
    if let Some(ns_window) = crate::float::mac::ns_window(window) {
        ns_window.orderOut(None);
        ns_window.orderFrontRegardless();
    }
    let _ = window;
}

/// After winit made it: whether the window is a panel, made non-activating and kept on screen while
/// the desk is inactive.
pub fn settle(window: &Window) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return mac::settle(window);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
        Ok(())
    }
}

#[cfg(target_os = "macos")]
#[allow(unsafe_code)]
pub(super) mod mac {
    use std::cell::Cell;
    use std::ffi::{CStr, c_void};

    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Imp, Sel};
    use objc2::{msg_send, sel};
    use objc2_app_kit::NSWindowStyleMask;
    use objc2_foundation::NSRect;
    use winit::window::Window;

    /// The shell's panel class: an `NSPanel` that may become key and never main.
    pub const PANEL: &CStr = c"DeskIslandPanel";
    /// `NSWindowStyleMaskNonactivatingPanel`.
    const NONACTIVATING: usize = 1 << 7;

    type Alloc = extern "C-unwind" fn(*const AnyClass, Sel) -> *mut AnyObject;
    type Init =
        extern "C-unwind" fn(*mut AnyObject, Sel, NSRect, usize, usize, Bool) -> *mut AnyObject;

    thread_local! {
        /// `NSWindow`'s own initializer, while the island's window is being made.
        static WINDOW_INIT: Cell<Option<Init>> = const { Cell::new(None) };
    }
    type AllocWithZone = extern "C-unwind" fn(*const AnyClass, Sel, *mut c_void) -> *mut AnyObject;

    extern "C-unwind" fn yes(_this: *mut AnyObject, _sel: Sel) -> Bool {
        Bool::YES
    }

    extern "C-unwind" fn no(_this: *mut AnyObject, _sel: Sel) -> Bool {
        Bool::NO
    }

    /// Whatever style winit sets, the panel stays non-activating.
    extern "C-unwind" fn set_style_mask(this: *mut AnyObject, _sel: Sel, mask: usize) {
        let Some(panel) = AnyClass::get(c"NSPanel") else {
            return;
        };
        // SAFETY: `this` is a live panel receiving `setStyleMask:`, which `NSPanel` implements.
        unsafe {
            let this = &*this;
            let _: () = msg_send![super(this, panel), setStyleMask: mask | NONACTIVATING];
        }
    }

    /// `NSWindow`'s initializer while winit makes the island's window: the panel is made with the
    /// non-activating style, the only way AppKit also keeps a press on it from activating the desk
    /// (setting the style later leaves that out). winit calls `NSWindow`'s initializer itself, past
    /// any subclass's.
    extern "C-unwind" fn init(
        this: *mut AnyObject,
        sel: Sel,
        rect: NSRect,
        mask: usize,
        backing: usize,
        defer: Bool,
    ) -> *mut AnyObject {
        let Some(original) = WINDOW_INIT.with(Cell::get) else {
            return std::ptr::null_mut();
        };
        // SAFETY: reading the class of the object being initialized.
        let class = unsafe { ffi::object_getClass(this) };
        let ours = AnyClass::get(PANEL).is_some_and(|panel| std::ptr::eq(class, panel));
        let mask = if ours { mask | NONACTIVATING } else { mask };
        original(this, sel, rect, mask, backing, defer)
    }

    extern "C-unwind" fn alloc(_class: *const AnyClass, _sel: Sel) -> *mut AnyObject {
        match panel_class() {
            // SAFETY: allocating an instance of a registered class; the caller owns it, as `alloc`'s.
            Some(panel) => unsafe { msg_send![panel, alloc] },
            None => std::ptr::null_mut(),
        }
    }

    extern "C-unwind" fn alloc_with_zone(
        _class: *const AnyClass,
        _sel: Sel,
        zone: *mut c_void,
    ) -> *mut AnyObject {
        match panel_class() {
            // SAFETY: as `alloc`.
            Some(panel) => unsafe { msg_send![panel, allocWithZone: zone] },
            None => std::ptr::null_mut(),
        }
    }

    /// The panel class, registered the first time.
    pub fn panel_class() -> Option<&'static AnyClass> {
        if let Some(class) = AnyClass::get(PANEL) {
            return Some(class);
        }
        let mut builder = ClassBuilder::new(PANEL, AnyClass::get(c"NSPanel")?)?;
        let answer = yes as extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool;
        let refuse = no as extern "C-unwind" fn(*mut AnyObject, Sel) -> Bool;
        let style = set_style_mask as extern "C-unwind" fn(*mut AnyObject, Sel, usize);
        // SAFETY: each implementation matches its selector's signature: `- (BOOL)canBecome…Window`
        // and `- (void)setStyleMask:(NSWindowStyleMask)`.
        unsafe {
            builder.add_method(sel!(canBecomeKeyWindow), answer);
            builder.add_method(sel!(canBecomeMainWindow), refuse);
            builder.add_method(sel!(setStyleMask:), style);
        }
        Some(builder.register())
    }

    /// Whether an object of `from` may stand for one of `to`: neither adds memory the other lacks.
    pub fn same_size(from: &AnyClass, to: &AnyClass) -> bool {
        from.instance_size() == to.instance_size()
    }

    pub fn made_as_panel<T>(make: impl FnOnce() -> T) -> T {
        let (Some(winit), Some(panel)) = (AnyClass::get(c"WinitWindow"), panel_class()) else {
            eprintln!("island: no panel class; a floating window");
            return make();
        };
        if !same_size(winit, panel) {
            eprintln!("island: winit's window is not the size of a panel; a floating window");
            return make();
        }
        let window_init = AnyClass::get(c"NSWindow")
            .and_then(|w| w.instance_method(sel!(initWithContentRect:styleMask:backing:defer:)));
        let Some(window_init) = window_init else {
            eprintln!("island: no NSWindow initializer; a floating window");
            return make();
        };
        let meta = std::ptr::from_ref(winit.metaclass()).cast_mut();
        // SAFETY: the implementations match `+ (instancetype)alloc` and `+ allocWithZone:`.
        let ours: [(Sel, Imp, &CStr); 2] = unsafe {
            [
                (
                    sel!(alloc),
                    std::mem::transmute::<Alloc, Imp>(alloc),
                    c"@@:",
                ),
                (
                    sel!(allocWithZone:),
                    std::mem::transmute::<AllocWithZone, Imp>(alloc_with_zone),
                    c"@@:^v",
                ),
            ]
        };
        let before: Vec<Option<Imp>> = (ours.iter())
            .map(|(sel, _, _)| winit.class_method(*sel).map(|m| m.implementation()))
            .collect();
        // SAFETY: on the main thread, where winit makes every window, for this one window only; the
        // implementations they had (`NSObject`'s allocation, `NSWindow`'s initializer) go back right
        // after, and `init` hands every other window to `NSWindow`'s initializer unchanged.
        unsafe {
            for (sel, imp, types) in &ours {
                ffi::class_replaceMethod(meta, *sel, *imp, types.as_ptr());
            }
            let original = window_init.set_implementation(std::mem::transmute::<Init, Imp>(init));
            WINDOW_INIT.with(|c| c.set(Some(std::mem::transmute::<Imp, Init>(original))));
        }
        let made = make();
        // SAFETY: as above.
        unsafe {
            if let Some(original) = WINDOW_INIT.with(Cell::take) {
                window_init.set_implementation(std::mem::transmute::<Init, Imp>(original));
            }
            for ((sel, _, types), imp) in ours.iter().zip(before) {
                if let Some(imp) = imp {
                    ffi::class_replaceMethod(meta, *sel, imp, types.as_ptr());
                }
            }
        }
        made
    }

    pub fn settle(window: &Window) -> Result<(), String> {
        let ns_window = crate::float::mac::ns_window(window).ok_or("no NSWindow")?;
        let panel = AnyClass::get(c"NSPanel").ok_or("no NSPanel")?;
        // SAFETY: asking a live window whether it is a panel.
        let is_panel: Bool = unsafe { msg_send![&*ns_window, isKindOfClass: panel] };
        if !is_panel.as_bool() {
            return Err("winit made an NSWindow".to_owned());
        }
        // The panel's own style setter makes it non-activating; winit's style is kept.
        ns_window.setStyleMask(ns_window.styleMask() | NSWindowStyleMask::NonactivatingPanel);
        ns_window.setHidesOnDeactivate(false);
        Ok(())
    }
}
