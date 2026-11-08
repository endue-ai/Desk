//! Synthesized input through CGEvent, posted at the HID tap as if from a device. Every event is
//! marked with `DESK_MARK` in `kCGEventSourceUserData`, so a later event tap can tell the desk's
//! input from the person's.

use objc2_core_foundation::{CFRetained, CGPoint};
use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventFlags, CGEventSource, CGEventSourceStateID, CGEventTapLocation,
    CGEventType, CGMouseButton, CGScrollEventUnit,
};

use crate::input::{Button, Event};
use crate::keys::{Key, Modifiers, mac_code};
use crate::{Error, ErrorCode, Point, invalid};

/// `desk` in ASCII, in every event's source user data.
pub(crate) const DESK_MARK: i64 = 0x6465_736B;

fn point(point: Point) -> CGPoint {
    CGPoint::new(point.x, point.y)
}

fn flags(modifiers: Modifiers) -> CGEventFlags {
    let mut flags = CGEventFlags::empty();
    for (held, flag) in [
        (modifiers.command, CGEventFlags::MaskCommand),
        (modifiers.shift, CGEventFlags::MaskShift),
        (modifiers.option, CGEventFlags::MaskAlternate),
        (modifiers.control, CGEventFlags::MaskControl),
        (modifiers.function, CGEventFlags::MaskSecondaryFn),
    ] {
        if held {
            flags |= flag;
        }
    }
    flags
}

fn mouse_type(button: Button, kind: usize) -> (CGEventType, CGMouseButton) {
    // `kind`: 0 down, 1 up, 2 dragged.
    let (types, cg) = match button {
        Button::Left => (
            [
                CGEventType::LeftMouseDown,
                CGEventType::LeftMouseUp,
                CGEventType::LeftMouseDragged,
            ],
            CGMouseButton::Left,
        ),
        Button::Right => (
            [
                CGEventType::RightMouseDown,
                CGEventType::RightMouseUp,
                CGEventType::RightMouseDragged,
            ],
            CGMouseButton::Right,
        ),
        Button::Middle => (
            [
                CGEventType::OtherMouseDown,
                CGEventType::OtherMouseUp,
                CGEventType::OtherMouseDragged,
            ],
            CGMouseButton::Center,
        ),
    };
    (types[kind], cg)
}

fn code(key: Key) -> Result<u16, Error> {
    mac_code(key).ok_or_else(|| invalid(format!("{key:?} has no key on the US layout")))
}

fn failed() -> Error {
    Error::new(
        ErrorCode::IoError,
        "CoreGraphics did not create the input event",
    )
}

/// The CGEvents of one event: one for the mouse and keys, a press and a release for text.
fn build(event: &Event, source: Option<&CGEventSource>) -> Result<Vec<CFRetained<CGEvent>>, Error> {
    let mouse = |kind: CGEventType, at: Point, button: CGMouseButton| {
        CGEvent::new_mouse_event(source, kind, point(at), button).ok_or_else(failed)
    };
    Ok(match event {
        Event::Move { to } => vec![mouse(CGEventType::MouseMoved, *to, CGMouseButton::Left)?],
        Event::Down { at, button, clicks } | Event::Up { at, button, clicks } => {
            let kind = usize::from(matches!(event, Event::Up { .. }));
            let (kind, cg) = mouse_type(*button, kind);
            let event = mouse(kind, *at, cg)?;
            CGEvent::set_integer_value_field(
                Some(&*event),
                CGEventField::MouseEventClickState,
                i64::from(*clicks),
            );
            vec![event]
        }
        Event::Drag { to, button } => {
            let (kind, cg) = mouse_type(*button, 2);
            vec![mouse(kind, *to, cg)?]
        }
        // CG's wheel 1 is vertical and positive up, wheel 2 horizontal and positive left.
        Event::Scroll { dx, dy } => vec![
            CGEvent::new_scroll_wheel_event2(source, CGScrollEventUnit::Line, 2, -dy, -dx, 0)
                .ok_or_else(failed)?,
        ],
        Event::KeyDown { key, modifiers } | Event::KeyUp { key, modifiers } => {
            let down = matches!(event, Event::KeyDown { .. });
            let event =
                CGEvent::new_keyboard_event(source, code(*key)?, down).ok_or_else(failed)?;
            CGEvent::set_flags(Some(&*event), flags(*modifiers));
            vec![event]
        }
        Event::Text { text } => {
            let units: Vec<u16> = text.encode_utf16().collect();
            let mut pair = Vec::with_capacity(2);
            for down in [true, false] {
                let event = CGEvent::new_keyboard_event(source, 0, down).ok_or_else(failed)?;
                CGEvent::set_flags(Some(&*event), CGEventFlags::empty());
                // SAFETY: `units` holds `units.len()` UTF-16 code units for the call.
                unsafe {
                    CGEvent::keyboard_set_unicode_string(
                        Some(&*event),
                        units.len() as _,
                        units.as_ptr(),
                    );
                }
                pair.push(event);
            }
            pair
        }
    })
}

/// Post one event at the HID tap.
pub(super) fn post(event: &Event) -> Result<(), Error> {
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState);
    for cg in build(event, source.as_deref())? {
        CGEvent::set_integer_value_field(Some(&*cg), CGEventField::EventSourceUserData, DESK_MARK);
        CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&*cg));
    }
    Ok(())
}
