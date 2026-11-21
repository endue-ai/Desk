use serde_json::json;

use super::*;

/// The main display's work area (less a 25-point menu bar) and a second display to its right.
const MAIN: Rect = Rect::new(0.0, 25.0, 1440.0, 875.0);
const SIDE: Rect = Rect::new(1440.0, 0.0, 1920.0, 1080.0);
const AREAS: [Rect; 2] = [MAIN, SIDE];
const FREE: Limits = Limits {
    least: (320.0, 200.0),
    fixed: false,
};
const NOW: Rect = Rect::new(100.0, 100.0, 720.0, 450.0);

fn ask(value: serde_json::Value) -> Ask {
    serde_json::from_value(value).expect("an ask")
}

fn run(value: serde_json::Value) -> Result<Plan, String> {
    plan(NOW, &AREAS, &ask(value), FREE, None)
}

#[test]
fn the_runtime_asks_read_as_the_runtime_sends_them() {
    assert_eq!(ask(json!({ "op": "look" })), Ask::Look);
    assert_eq!(
        ask(json!({ "op": "move", "x": 40, "dy": 10 })),
        Ask::Move {
            x: Some(40.0),
            y: None,
            dx: None,
            dy: Some(10.0)
        }
    );
    assert_eq!(
        ask(json!({ "op": "fill", "fill": "top-left" })),
        Ask::Fill {
            fill: Part::Fill(Fill::TopLeft)
        }
    );
    assert_eq!(
        ask(json!({ "op": "fill", "fill": "none" })),
        Ask::Fill {
            fill: Part::None(NoneWord::None)
        }
    );
    assert_eq!(
        ask(json!({ "op": "pin", "pinned": true })),
        Ask::Pin { pinned: true }
    );
    assert!(serde_json::from_value::<Ask>(json!({ "op": "fill", "fill": "middle" })).is_err());
    assert!(serde_json::from_value::<Ask>(json!({ "op": "fling" })).is_err());
}

#[test]
fn a_move_goes_to_a_point_or_by_a_step_and_keeps_the_title_bar_in_reach() {
    let to = run(json!({ "op": "move", "x": 40, "dy": 10 })).unwrap();
    assert_eq!(to.frame, Rect::new(40.0, 110.0, 720.0, 450.0));
    assert_eq!(to.screen, MAIN);
    // Onto the second display: its work area is the one answered.
    let side = run(json!({ "op": "move", "x": 2000, "y": 300 })).unwrap();
    assert_eq!(side.frame, Rect::new(2000.0, 300.0, 720.0, 450.0));
    assert_eq!(side.screen, SIDE);
    // Far off every display, or under the menu bar: back within reach of the nearest one.
    let off = run(json!({ "op": "move", "x": -5000, "y": -300 })).unwrap();
    assert_eq!(off.frame, Rect::new(-720.0 + REACH.0, 25.0, 720.0, 450.0));
    let low = run(json!({ "op": "move", "y": 5000 })).unwrap();
    assert_eq!(low.frame.y, 875.0 + 25.0 - REACH.1);
    assert!(
        run(json!({ "op": "move", "x": 1, "dx": 1 }))
            .unwrap_err()
            .contains("not both")
    );
}

#[test]
fn a_resize_keeps_the_apps_smallest_size_and_the_work_area_and_its_corner() {
    let to = run(json!({ "op": "resize", "w": 900, "dh": -50 })).unwrap();
    assert_eq!(to.frame, Rect::new(100.0, 100.0, 900.0, 400.0));
    let tiny = run(json!({ "op": "resize", "w": 10, "h": 10 })).unwrap();
    assert_eq!((tiny.frame.w, tiny.frame.h), (320.0, 200.0));
    let huge = run(json!({ "op": "resize", "w": 9000, "h": 9000 })).unwrap();
    assert_eq!((huge.frame.w, huge.frame.h), (MAIN.w, MAIN.h));
    let fixed = Limits {
        least: (480.0, 360.0),
        fixed: true,
    };
    let kept = plan(
        NOW,
        &AREAS,
        &ask(json!({ "op": "resize", "w": 900 })),
        fixed,
        None,
    );
    assert_eq!(kept.unwrap().frame, NOW);
}

#[test]
fn a_fill_takes_its_part_of_the_work_area_and_none_comes_back() {
    let left = run(json!({ "op": "fill", "fill": "left" })).unwrap();
    assert_eq!(left.frame, Rect::new(0.0, 25.0, 720.0, 875.0));
    let filled = left.filled.expect("in a fill");
    assert_eq!((filled.fill, filled.before), (Fill::Left, NOW));
    // From one fill to another, before stays where it was before the first.
    let quarter = ask(json!({ "op": "fill", "fill": "bottom-right" }));
    let corner = plan(left.frame, &AREAS, &quarter, FREE, Some(filled)).unwrap();
    assert_eq!(corner.frame, Rect::new(720.0, 462.5, 720.0, 437.5));
    assert_eq!(corner.filled.map(|f| f.before), Some(NOW));
    let none = ask(json!({ "op": "fill", "fill": "none" }));
    let back = plan(corner.frame, &AREAS, &none, FREE, corner.filled).unwrap();
    assert_eq!((back.frame, back.filled), (NOW, None));
    let full = run(json!({ "op": "fill", "fill": "full" })).unwrap();
    assert_eq!(full.frame, MAIN);
}

#[test]
fn a_fill_the_person_moved_away_from_is_over() {
    let left = run(json!({ "op": "fill", "fill": "left" })).unwrap();
    let dragged = Rect::new(300.0, 200.0, 720.0, 875.0);
    let none = ask(json!({ "op": "fill", "fill": "none" }));
    let stays = plan(dragged, &AREAS, &none, FREE, left.filled).unwrap();
    assert_eq!((stays.frame, stays.filled), (dragged, None));
    let look = plan(dragged, &AREAS, &Ask::Look, FREE, left.filled).unwrap();
    assert_eq!(look.filled, None);
    // A move ends a fill where it goes.
    let moved = plan(
        left.frame,
        &AREAS,
        &ask(json!({ "op": "move", "dx": 10 })),
        FREE,
        left.filled,
    );
    assert_eq!(moved.unwrap().filled, None);
}

#[test]
fn a_window_that_keeps_its_size_does_not_fill() {
    let fixed = Limits {
        least: (480.0, 360.0),
        fixed: true,
    };
    let fill = ask(json!({ "op": "fill", "fill": "left" }));
    assert!(
        plan(NOW, &AREAS, &fill, fixed, None)
            .unwrap_err()
            .contains("keeps its size")
    );
}

#[test]
fn every_part_tiles_the_work_area() {
    let a = Rect::new(10.0, 20.0, 1001.0, 801.0);
    let halves = [part(a, Fill::Left), part(a, Fill::Right)];
    assert_eq!(halves[0].w + halves[1].w, a.w);
    let quarters = [
        part(a, Fill::TopLeft),
        part(a, Fill::TopRight),
        part(a, Fill::BottomLeft),
        part(a, Fill::BottomRight),
    ];
    let area: f64 = quarters.iter().map(|q| q.w * q.h).sum();
    assert!((area - a.w * a.h).abs() < 1e-6);
    assert_eq!(part(a, Fill::Bottom).y + part(a, Fill::Bottom).h, a.y + a.h);
}
