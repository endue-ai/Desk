//! Ported from `packages/runtime/src/shell/minimap-model.test.ts` and `Pan.test.ts`, case by case,
//! with the pan rules of `shell/Pan.ts` that its e2e (`shell-canvas.spec.ts`) checks through the
//! DOM.

use desk_wm::{
    Fit, MAP, Offset, PanDrag, PanTarget, Rect, WheelMode, drag_pans, fit_world, hint_shows,
    pan_by_key, pan_centred_on, pan_moved_by, reset_shows, to_map, to_world, view_rect, wheel_pan,
    wheel_pans, world_of,
};

/// `toBeCloseTo`'s default: two decimals.
fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 0.005
}

mod the_canvas_maps_world {
    use super::*;

    #[test]
    fn is_the_part_in_sight_when_no_window_lies_outside_it_with_a_margin() {
        let view = view_rect(Offset::new(0.0, 0.0), 1440.0, 900.0);
        assert_eq!(view, Rect::new(0.0, 0.0, 1440.0, 900.0));
        let world = world_of(&[Rect::new(200.0, 100.0, 400.0, 300.0)], view);
        let m = 1440.0 * 0.06;
        assert_eq!(world, Rect::new(-m, -m, 1440.0 + 2.0 * m, 900.0 + 2.0 * m));
    }

    #[test]
    fn reaches_every_window_however_far_the_canvas_holds_it() {
        let view = view_rect(Offset::new(-500.0, 0.0), 1440.0, 900.0);
        let world = world_of(
            &[
                Rect::new(-2000.0, 100.0, 600.0, 400.0),
                Rect::new(3000.0, 1800.0, 500.0, 500.0),
            ],
            view,
        );
        let m = 5500.0 * 0.06;
        assert!(close(world.x, -2000.0 - m));
        assert!(close(world.x + world.w, 3500.0 + m));
        assert!(close(world.y, 0.0 - m));
        assert!(close(world.y + world.h, 2300.0 + m));
    }
}

mod fitting_the_world_into_the_map {
    use super::*;

    #[test]
    fn keeps_the_proportions_and_centres_the_world_on_the_axis_it_does_not_fill() {
        // Twice as wide as the box's proportions: the width fills, the height is centred.
        let world = Rect::new(0.0, 0.0, 2880.0, 900.0);
        let fit = fit_world(world, MAP);
        assert!(close(fit.scale, MAP.w / 2880.0));
        let others = to_map(world, fit);
        assert!(close(others.x, 0.0));
        assert!(close(others.w, MAP.w));
        assert!(close(others.y + others.h / 2.0, MAP.h / 2.0));
    }

    #[test]
    fn maps_a_point_there_and_back() {
        let fit = fit_world(Rect::new(-700.0, 300.0, 4000.0, 2500.0), MAP);
        let there = to_map(Rect::new(123.0, 456.0, 0.0, 0.0), fit);
        let back = to_world(there.x, there.y, fit);
        assert!(close(back.x, 123.0));
        assert!(close(back.y, 456.0));
    }
}

mod moving_the_canvas_from_the_map {
    use super::*;

    #[test]
    fn centres_the_part_in_sight_on_the_point_pressed() {
        let pan = pan_centred_on(Offset::new(2000.0, 1000.0), 1440.0, 900.0);
        assert_eq!(pan, Offset::new(720.0 - 2000.0, 450.0 - 1000.0));
        let view = view_rect(pan, 1440.0, 900.0);
        assert_eq!(view.x + view.w / 2.0, 2000.0);
        assert_eq!(view.y + view.h / 2.0, 1000.0);
    }

    #[test]
    fn follows_a_drag_of_the_part_in_sight_scaled_up_to_world_pixels() {
        let fit = Fit {
            scale: 0.1,
            x: 0.0,
            y: 0.0,
        };
        // The frame moved 10 map pixels right and 5 down: the view moved 100 and 50 world pixels.
        assert_eq!(
            pan_moved_by(Offset::new(0.0, 0.0), 10.0, 5.0, fit),
            Offset::new(-100.0, -50.0)
        );
    }

    #[test]
    fn steps_a_quarter_of_the_view_with_an_arrow_key_a_whole_one_with_shift() {
        let at = Offset::new(0.0, 0.0);
        let key = |key, whole| pan_by_key(at, key, whole, 1440.0, 900.0);
        assert_eq!(key("ArrowRight", false), Some(Offset::new(-360.0, 0.0)));
        assert_eq!(key("ArrowLeft", false), Some(Offset::new(360.0, 0.0)));
        assert_eq!(key("ArrowDown", true), Some(Offset::new(0.0, -900.0)));
        assert_eq!(key("ArrowUp", true), Some(Offset::new(0.0, 900.0)));
        assert_eq!(key("Enter", false), None);
    }
}

mod the_canvas_hint {
    use super::*;

    #[test]
    fn is_the_empty_canvass_alone_never_a_controls_tooltip() {
        assert!(hint_shows(PanTarget::Background));
        for target in [PanTarget::Control, PanTarget::TitleBar, PanTarget::Content] {
            assert!(!hint_shows(target), "{target:?}");
        }
    }
}

mod the_canvas_pan {
    use super::*;

    #[test]
    fn shift_and_a_drag_on_the_empty_background_or_a_title_bar_pans_and_a_plain_drag_never_does() {
        assert!(drag_pans(true, PanTarget::Background));
        assert!(drag_pans(true, PanTarget::TitleBar));
        assert!(!drag_pans(true, PanTarget::Control));
        assert!(!drag_pans(true, PanTarget::Content));
        assert!(!drag_pans(false, PanTarget::Background));
        assert!(!drag_pans(false, PanTarget::TitleBar));
    }

    #[test]
    fn a_drag_moves_the_canvas_from_where_it_started_and_escape_puts_it_back() {
        let drag = PanDrag::start(Offset::new(30.0, -20.0), "1");
        assert_eq!(drag.moved(15.0, 5.0, "1"), Some(Offset::new(45.0, -15.0)));
        assert_eq!(drag.cancelled("1"), Some(Offset::new(30.0, -20.0)));
    }

    #[test]
    fn a_drag_leaves_a_desktop_switched_to_meanwhile_where_it_is() {
        let drag = PanDrag::start(Offset::new(0.0, 0.0), "1");
        assert_eq!(drag.moved(15.0, 5.0, "2"), None);
        assert_eq!(drag.cancelled("2"), None);
    }

    #[test]
    fn the_wheel_scrolls_the_canvas_as_a_page_in_pixels_lines_of_16_or_pages() {
        let at = Offset::new(10.0, 10.0);
        let page = 800.0;
        assert_eq!(
            wheel_pan(at, 5.0, -3.0, WheelMode::Pixel, page),
            Offset::new(5.0, 13.0)
        );
        assert_eq!(
            wheel_pan(at, 1.0, 2.0, WheelMode::Line, page),
            Offset::new(-6.0, -22.0)
        );
        assert_eq!(
            wheel_pan(at, 0.0, 1.0, WheelMode::Page, page),
            Offset::new(10.0, -790.0)
        );
    }

    #[test]
    fn the_wheel_pans_over_the_empty_background_only_not_with_control_nor_while_dragging() {
        assert!(wheel_pans(PanTarget::Background, false, false));
        assert!(!wheel_pans(PanTarget::TitleBar, false, false));
        assert!(!wheel_pans(PanTarget::Background, true, false));
        assert!(!wheel_pans(PanTarget::Background, false, true));
    }

    #[test]
    fn the_reset_button_shows_while_the_canvas_is_away_from_its_origin() {
        assert!(!reset_shows(Offset::new(0.0, 0.0)));
        assert!(reset_shows(Offset::new(0.0, -1.0)));
        assert!(reset_shows(Offset::new(12.0, 0.0)));
    }
}

/// The cases of `packages/runtime/src/shell/Minimap.test.ts` (#54) that are the window manager's:
/// when the map shows, when it folds by itself, and a drag in it.
mod the_canvas_map_on_the_desk {
    use super::*;
    use desk_wm::edits::{Edit, Kept, apply};
    use desk_wm::{Desk, MapDrag, Size, fill_in_sight, map_shows};
    use serde_json::json;

    const APP: Size = Size {
        w: 1440.0,
        h: 900.0,
    };

    fn edit(desk: &mut Desk, edit: serde_json::Value) {
        let edit: Edit = serde_json::from_value(edit).unwrap();
        apply(desk, &mut Kept::default(), &edit, APP);
    }

    fn window(id: &str, more: serde_json::Value) -> serde_json::Value {
        let mut p = json!({ "id": id, "plugin": "endue.shell", "x": 100, "y": 80, "w": 600,
            "h": 400, "pinned": false });
        for (k, v) in more.as_object().unwrap() {
            p[k] = v.clone();
        }
        json!({ "op": "place", "placement": p })
    }

    #[test]
    fn is_not_there_while_the_canvas_holds_nothing_to_find() {
        let mut desk = Desk::default();
        assert!(!map_shows(&desk));
        // A floating window is always in sight: nothing to find on the canvas.
        edit(&mut desk, window("player", json!({ "floating": true })));
        assert!(!map_shows(&desk));
        edit(
            &mut desk,
            json!({ "op": "pan", "to": { "x": -200, "y": 0 } }),
        );
        assert!(map_shows(&desk), "panned away from the start");
        edit(&mut desk, json!({ "op": "pan", "to": { "x": 0, "y": 0 } }));
        edit(&mut desk, window("notes", json!({})));
        assert!(map_shows(&desk), "a normal window");
    }

    #[test]
    fn folds_by_itself_while_a_filled_window_is_in_sight() {
        let mut desk = Desk::default();
        edit(&mut desk, window("notes", json!({})));
        assert!(!fill_in_sight(&desk, APP.w, APP.h));
        let filled = json!({ "floating": true, "fill": "left" });
        edit(&mut desk, window("files", filled));
        assert!(fill_in_sight(&desk, APP.w, APP.h));
    }

    #[test]
    fn a_drag_moves_the_view_with_the_fit_it_held_and_escape_puts_it_back() {
        let fit = Fit {
            scale: 0.1,
            x: 0.0,
            y: 0.0,
        };
        let drag = MapDrag {
            before: Offset::new(30.0, 0.0),
            fit,
            desktop: "1".into(),
        };
        let from = Offset::new(0.0, 0.0);
        assert_eq!(
            drag.moved(from, 10.0, 5.0, "1"),
            Some(Offset::new(-100.0, -50.0))
        );
        assert_eq!(drag.moved(from, 10.0, 5.0, "2"), None, "another desktop");
        assert_eq!(drag.cancelled("1"), Some(Offset::new(30.0, 0.0)));
    }
}
