//! macOS's half of `os_dnd` (#309).
//!
//! * **Out.** `hand_off` starts an `NSDraggingSession` from winit's view with one dragging item per
//!   file (its file URL, its Finder icon), with the event AppKit is handling now (the mouse drag
//!   that crossed the edge), offering the operations the desk drag allowed. The session's source
//!   (`DragSource`) says how it ended.
//! * **In.** winit's window delegate takes only file names (`NSFilenamesPboardType`) and refuses
//!   any other drag. `listen` registers the desk window for strings and URLs too and wraps the
//!   delegate's `draggingEntered:` and `performDragOperation:`: winit's own runs first, and only a
//!   drag it refused that carries text or a URL becomes compositor input. `draggingExited:` stays
//!   winit's: it says the drag left (`HoveredFileCancelled`), which ends a drag of data as well.
//!   winit's delegate class serves every winit window, so the wrap acts for the desk window's
//!   delegate alone and leaves the others as winit made them.
#![allow(unsafe_code)]

use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicUsize, Ordering};

use desk_compositor::input::Input;
use desk_surface::generated::SurfaceDropAnswer;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, ProtocolObject, Sel};
use objc2::{AllocAnyThread, DefinedClass, MainThreadOnly, define_class, msg_send, sel};
use objc2_app_kit::{
    NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
    NSDraggingSource, NSFilenamesPboardType, NSPasteboard, NSPasteboardTypeString,
    NSPasteboardTypeURL, NSView, NSWorkspace,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSObject, NSObjectProtocol, NSPoint, NSRect, NSSize, NSString, NSURL,
};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use winit::window::Window;

use crate::pump::Pump;

/// What hears how a hand-off ended.
pub type Ended = Box<dyn FnOnce(Option<SurfaceDropAnswer>)>;

pub struct SourceIvars {
    mask: usize,
    ended: RefCell<Option<Ended>>,
}

define_class!(
    /// The source of one OS drag the desk handed off: the operations it offers, and who hears its end.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "EndueDeskDragSource"]
    #[ivars = SourceIvars]
    pub struct DragSource;

    unsafe impl NSObjectProtocol for DragSource {}

    unsafe impl NSDraggingSource for DragSource {
        #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
        fn operation_mask(
            &self,
            _session: &NSDraggingSession,
            _context: NSDraggingContext,
        ) -> NSDragOperation {
            NSDragOperation(self.ivars().mask)
        }

        #[unsafe(method(draggingSession:endedAtPoint:operation:))]
        fn ended_at(&self, _session: &NSDraggingSession, _at: NSPoint, operation: NSDragOperation) {
            let ended = self.ivars().ended.borrow_mut().take();
            if let Some(ended) = ended {
                ended(Some(super::effect_of(operation.0)));
            }
            let this: *const Self = self;
            SOURCES.with(|sources| sources.borrow_mut().retain(|s| !std::ptr::eq(&**s, this)));
        }
    }
);

impl DragSource {
    fn new(mtm: MainThreadMarker, mask: usize, ended: Ended) -> Retained<Self> {
        let this = Self::alloc(mtm).set_ivars(SourceIvars {
            mask,
            ended: RefCell::new(Some(ended)),
        });
        // SAFETY: NSObject's init, on a freshly allocated object with its ivars set.
        unsafe { msg_send![super(this), init] }
    }
}

thread_local! {
    /// The sources of the OS drags under way, kept alive until each ends.
    static SOURCES: RefCell<Vec<Retained<DragSource>>> = const { RefCell::new(Vec::new()) };
}

/// winit's content view of `window`, on the main thread.
fn ns_view(window: &Window) -> Option<&NSView> {
    MainThreadMarker::new()?;
    let RawWindowHandle::AppKit(handle) = window.window_handle().ok()?.as_raw() else {
        return None;
    };
    // SAFETY: winit's handle is its live content view, and this runs on the main thread; the
    // reference does not outlive the window it was taken from.
    unsafe { handle.ns_view.as_ptr().cast::<NSView>().as_ref() }
}

/// Start the OS drag of `paths`: `Err` gives `ended` back when none could start.
pub fn hand_off(
    window: &Window,
    paths: &[PathBuf],
    mask: usize,
    ended: Ended,
) -> Result<(), Ended> {
    let (Some(mtm), Some(view)) = (MainThreadMarker::new(), ns_view(window)) else {
        return Err(ended);
    };
    let Some(event) = NSApplication::sharedApplication(mtm).currentEvent() else {
        return Err(ended);
    };
    if mask == 0 {
        return Err(ended);
    }
    let at = view.convertPoint_fromView(event.locationInWindow(), None);
    let workspace = NSWorkspace::sharedWorkspace();
    let items: Vec<Retained<NSDraggingItem>> = paths
        .iter()
        .filter_map(|path| {
            let path = NSString::from_str(path.to_str()?);
            let url = NSURL::fileURLWithPath(&path);
            let writer = ProtocolObject::from_ref(&*url);
            let item = NSDraggingItem::initWithPasteboardWriter(NSDraggingItem::alloc(), writer);
            let icon = workspace.iconForFile(&path);
            let frame = NSRect::new(
                NSPoint::new(at.x - 16.0, at.y - 16.0),
                NSSize::new(32.0, 32.0),
            );
            // SAFETY: the contents are an NSImage, as AppKit takes for a dragging item's image.
            unsafe {
                item.setDraggingFrame_contents(frame, Some(AsRef::<AnyObject>::as_ref(&*icon)))
            };
            Some(item)
        })
        .collect();
    if items.is_empty() {
        return Err(ended);
    }
    let source = DragSource::new(mtm, mask, ended);
    let items = NSArray::from_retained_slice(&items);
    let _session = view.beginDraggingSessionWithItems_event_source(
        &items,
        &event,
        ProtocolObject::from_ref(&*source),
    );
    SOURCES.with(|sources| sources.borrow_mut().push(source));
    Ok(())
}

static PUMP: OnceLock<(Pump, fn(&Pump, Input))> = OnceLock::new();
static ENTERED: OnceLock<Imp> = OnceLock::new();
static PERFORMED: OnceLock<Imp> = OnceLock::new();
/// The desk window's delegate: the only one the wrapped methods act for.
static DESK_DELEGATE: AtomicUsize = AtomicUsize::new(0);

type Entered = unsafe extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> Bool;

/// The text and URL a drag's pasteboard carries, as desk data; `None` when it carries neither.
fn data_of(sender: &AnyObject) -> Option<(Option<String>, Vec<String>)> {
    // SAFETY: `sender` is the NSDraggingInfo AppKit passes to a dragging destination.
    let pasteboard: Option<Retained<NSPasteboard>> =
        unsafe { msg_send![sender, draggingPasteboard] };
    let pasteboard = pasteboard?;
    // SAFETY: the pasteboard types are AppKit's own constants.
    let (text, url) = unsafe {
        (
            pasteboard.stringForType(NSPasteboardTypeString),
            pasteboard.stringForType(NSPasteboardTypeURL),
        )
    };
    let (text, uris) =
        super::pasteboard_data(text.map(|s| s.to_string()), url.map(|s| s.to_string()));
    (text.is_some() || !uris.is_empty()).then_some((text, uris))
}

/// winit's own method first; a drag it refused that carries data becomes `input` for the desk.
fn relay(
    this: &AnyObject,
    sel: Sel,
    sender: &AnyObject,
    original: &OnceLock<Imp>,
    input: fn(Option<String>, Vec<String>) -> Input,
) -> bool {
    if let Some(original) = original.get() {
        // SAFETY: the implementation winit registered for this selector, with its signature.
        let winit = unsafe { std::mem::transmute::<Imp, Entered>(*original) };
        // SAFETY: called as AppKit called the wrapper: the same receiver, selector and sender.
        if unsafe { winit(this, sel, sender) }.as_bool() {
            return true;
        }
    }
    if this as *const AnyObject as usize != DESK_DELEGATE.load(Ordering::Relaxed) {
        return false;
    }
    let (Some((text, uris)), Some((pump, deliver))) = (data_of(sender), PUMP.get()) else {
        return false;
    };
    deliver(pump, input(text, uris));
    true
}

extern "C-unwind" fn entered(this: &AnyObject, sel: Sel, sender: &AnyObject) -> usize {
    let took = relay(this, sel, sender, &ENTERED, |text, uris| {
        Input::OsDataHovered { text, uris }
    });
    if took { super::OP_COPY } else { 0 }
}

extern "C-unwind" fn performed(this: &AnyObject, sel: Sel, sender: &AnyObject) -> Bool {
    Bool::new(relay(this, sel, sender, &PERFORMED, |text, uris| {
        Input::OsDataDropped { text, uris }
    }))
}

/// Take text and links over the desk window `window` as well as files. Once, on the main thread.
pub fn listen(window: &Window, pump: Pump, deliver: fn(&Pump, Input)) {
    let Some(ns_window) = ns_view(window).and_then(NSView::window) else {
        return;
    };
    let Some(delegate) = ns_window.delegate() else {
        return;
    };
    let delegate: &AnyObject = delegate.as_ref();
    DESK_DELEGATE.store(delegate as *const AnyObject as usize, Ordering::Relaxed);
    if PUMP.set((pump, deliver)).is_err() {
        return;
    }
    let class = AnyObject::class(delegate) as *const AnyClass;
    let wraps: [(Sel, Imp, &OnceLock<Imp>); 2] = [
        // SAFETY: each wrapper has the selector's signature (`Q@:@`, `B@:@`).
        (
            sel!(draggingEntered:),
            unsafe {
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> usize, Imp>(
                    entered,
                )
            },
            &ENTERED,
        ),
        (
            sel!(performDragOperation:),
            unsafe {
                std::mem::transmute::<extern "C-unwind" fn(&AnyObject, Sel, &AnyObject) -> Bool, Imp>(
                    performed,
                )
            },
            &PERFORMED,
        ),
    ];
    for (sel, wrapper, original) in wraps {
        // SAFETY: the class is the live delegate's, on the main thread; the method is winit's own,
        // kept to be called first.
        if let Some(method) = unsafe { (*class).instance_method(sel) }
            && original.set(method.implementation()).is_ok()
        {
            unsafe { method.set_implementation(wrapper) };
        }
    }
    // SAFETY: AppKit's own pasteboard type constants.
    let types = unsafe {
        NSArray::from_slice(&[
            NSFilenamesPboardType,
            NSPasteboardTypeString,
            NSPasteboardTypeURL,
        ])
    };
    ns_window.registerForDraggedTypes(&types);
}
