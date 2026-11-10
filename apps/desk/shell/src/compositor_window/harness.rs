//! The input harness (#56, development builds): a check over DevTools hands the compositor window
//! the same events winit would (`compositor_input { events, logical?, osPointer? }`), which go
//! through the same entry the event loop uses, [`super::CompositorWindow::input`]; `osPointer: false`
//! keeps an OS drag where the check put the pointer, not where the OS pointer is. The screen of the machine
//! running the checks may be locked, so no real device can type or point; the result is read back in
//! the surfaces themselves over DevTools, and in `compositor_input_state`.

use desk_compositor::input::Input;
use serde_json::Value;

/// The events of a `compositor_input` call; with `logical`, positions are the window's logical
/// pixels and become device pixels at `scale`.
pub fn events(args: &Value, scale: f64) -> Result<Vec<Input>, String> {
    let all = args.get("events").cloned().unwrap_or(Value::Null);
    let mut events: Vec<Input> =
        serde_json::from_value(all).map_err(|why| format!("not input events: {why}"))?;
    if args.get("logical").and_then(Value::as_bool) == Some(true) {
        for event in &mut events {
            match event {
                Input::PointerMoved { x, y } => {
                    *x *= scale as f32;
                    *y *= scale as f32;
                }
                Input::Wheel { dx, dy, unit }
                    if *unit == desk_surface::generated::SurfaceWheelUnit::Pixel =>
                {
                    *dx *= scale;
                    *dy *= scale;
                }
                _ => {}
            }
        }
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::events;
    use desk_compositor::input::{Button, ImeInput, Input};
    use serde_json::json;

    #[test]
    fn a_checks_events_are_winits_in_logical_or_device_pixels() {
        let args = json!({ "logical": true, "events": [
            { "type": "pointerMoved", "x": 10, "y": 20 },
            { "type": "pointerButton", "button": "left", "pressed": true },
            { "type": "ime", "ime": "preedit", "text": "한", "cursor": [3, 3] },
            { "type": "key", "key": "a", "code": "KeyA", "text": "a", "pressed": true },
        ] });
        let all = events(&args, 2.0).unwrap();
        assert_eq!(all[0], Input::PointerMoved { x: 20.0, y: 40.0 });
        assert_eq!(
            all[1],
            Input::PointerButton {
                button: Button::Left,
                pressed: true
            }
        );
        assert_eq!(
            all[2],
            Input::Ime(ImeInput::Preedit {
                text: "한".into(),
                cursor: Some((3, 3))
            })
        );
        assert!(events(&json!({ "events": [{ "type": "nonsense" }] }), 1.0).is_err());
    }
}
