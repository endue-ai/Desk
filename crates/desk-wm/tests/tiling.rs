//! Ported from `packages/runtime/src/surface/tiling.test.ts` (the slots of unplaced plugin windows,
//! ADR 0040), the tile grid and the cascade of `arrange/geometry.test.ts` (ADR 0116), and
//! `shell/windows.test.ts`'s case of a plugin window arriving on a panned canvas.

use std::collections::BTreeSet;

use desk_wm::{
    Adopted, CASCADE, FREE, GAP, Offset, Rect, Size, arrange_area, cascade_rects, cascade_size,
    free_slot, grid_shape, screen_rect, slot_rect, slot_windows, tile_rects,
};

mod slots {
    use super::*;

    #[test]
    fn lays_the_first_six_out_in_the_free_area_without_overlap_in_reading_order_one_size() {
        let rects: Vec<Rect> = (0..6).map(slot_rect).collect();
        for r in &rects {
            assert!(r.x >= FREE.x);
            assert!(r.y >= FREE.y);
            assert!(r.x + r.w <= FREE.x + FREE.w);
            assert!(r.y + r.h <= FREE.y + FREE.h);
            assert_eq!((r.w, r.h), (rects[0].w, rects[0].h));
        }
        for i in 0..6 {
            for j in i + 1..6 {
                assert!(!rects[i].overlaps(&rects[j]), "{i} and {j}");
            }
        }
        // Reading order: the second sits to the right of the first, the fourth under it.
        assert!(rects[1].x > rects[0].x);
        assert_eq!(rects[1].y, rects[0].y);
        assert!(rects[3].y > rects[0].y);
    }

    #[test]
    fn cascades_the_next_six_over_the_first() {
        let first = slot_rect(0);
        assert_eq!(CASCADE, 32.0);
        assert_eq!(
            slot_rect(6),
            Rect {
                x: first.x + CASCADE,
                y: first.y + CASCADE,
                ..first
            }
        );
    }

    #[test]
    fn gives_a_slots_rect_regardless_of_the_others_no_window_resizes_for_another() {
        assert_eq!(slot_rect(2), slot_rect(2));
        assert_eq!(free_slot([]), 0);
        assert_eq!(free_slot([0, 1, 3]), 2);
        assert_eq!(free_slot([1, 2]), 0);
    }
}

mod normal_and_floating_windows {
    use super::*;

    #[test]
    fn a_plugin_window_arriving_on_a_panned_canvas_takes_its_slot_in_sight() {
        let pan = Offset::new(-500.0, -300.0);
        let adopted = [Adopted {
            id: "p.a".into(),
            title: "A".into(),
            slot: Some(0),
            at: Some(pan),
            area: None,
        }];
        let windows = slot_windows(&adopted, |_| false);
        assert_eq!(windows.len(), 1);
        let r = screen_rect(&windows[0], pan, 1440.0, 900.0);
        assert_eq!((r.x, r.y), (slot_rect(0).x, slot_rect(0).y));
    }
}

const APPS: [Size; 5] = [
    Size {
        w: 1440.0,
        h: 900.0,
    },
    Size {
        w: 1280.0,
        h: 800.0,
    },
    Size {
        w: 1024.0,
        h: 768.0,
    },
    Size {
        w: 2560.0,
        h: 1080.0,
    },
    Size {
        w: 900.0,
        h: 1200.0,
    },
];

mod the_tile_grid {
    use super::*;

    /// `fills the canvas with no overlap for 1 to 12 windows at ${vw}×${vh}`
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(app: Size) {
        let area = arrange_area(app.w, app.h, true);
        let gap = 12.0;
        for n in 1..=12 {
            let rects = tile_rects(n, area, gap);
            assert_eq!(rects.len(), n);
            for (i, a) in rects.iter().enumerate() {
                assert!(a.w > 0.0);
                assert!(a.h > 0.0);
                for b in &rects[i + 1..] {
                    assert!(!a.overlaps(b), "{n} windows: {a:?} and {b:?}");
                }
            }
            // Rows from the area's top to its bottom, `gap` apart; in each, cells from its left to
            // its right edge, `gap` apart: nothing of the area is left but the gaps.
            let tops: BTreeSet<i64> = rects.iter().map(|r| r.y as i64).collect();
            let rows: Vec<f64> = tops.into_iter().map(|y| y as f64).collect();
            let height = |y: f64| rects.iter().find(|r| r.y == y).map_or(0.0, |r| r.h);
            assert_eq!(rows[0], area.y);
            let last = *rows.last().unwrap();
            assert_eq!(last + height(last), area.y + area.h);
            for pair in rows.windows(2) {
                assert_eq!(pair[1] - (pair[0] + height(pair[0])), gap);
            }
            for &y in &rows {
                let mut row: Vec<&Rect> = rects.iter().filter(|r| r.y == y).collect();
                row.sort_by(|a, b| a.x.total_cmp(&b.x));
                assert_eq!(row[0].x, area.x);
                let end = row[row.len() - 1];
                assert_eq!(end.x + end.w, area.x + area.w);
                for pair in row.windows(2) {
                    assert_eq!(pair[1].x - (pair[0].x + pair[0].w), gap);
                    assert_eq!(pair[1].h, row[0].h);
                }
            }
        }
    }

    #[test]
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at_1440x900() {
        fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(APPS[0]);
    }

    #[test]
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at_1280x800() {
        fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(APPS[1]);
    }

    #[test]
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at_1024x768() {
        fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(APPS[2]);
    }

    #[test]
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at_2560x1080() {
        fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(APPS[3]);
    }

    #[test]
    fn fills_the_canvas_with_no_overlap_for_1_to_12_windows_at_900x1200() {
        fills_the_canvas_with_no_overlap_for_1_to_12_windows_at(APPS[4]);
    }

    #[test]
    fn follows_the_count_and_the_aspect() {
        let wide = arrange_area(1440.0, 900.0, true);
        let shape = |n, area| {
            let s = grid_shape(n, area, GAP);
            (s.cols, s.rows)
        };
        assert_eq!(shape(1, wide), (1, 1));
        assert_eq!(shape(2, wide), (2, 1));
        assert_eq!(shape(4, wide), (2, 2));
        assert_eq!(shape(5, wide), (3, 2));
        assert_eq!(shape(6, wide), (3, 2));
        assert_eq!(shape(12, wide), (4, 3));
        let tall = arrange_area(900.0, 1200.0, true);
        assert_eq!(shape(2, tall), (1, 2));
    }

    #[test]
    fn starts_under_eris_in_her_default_place_and_higher_when_she_was_moved() {
        assert_eq!(
            arrange_area(1440.0, 900.0, true),
            Rect::new(104.0, 190.0, 1232.0, 598.0)
        );
        assert_eq!(
            arrange_area(1440.0, 900.0, false),
            Rect::new(104.0, 72.0, 1232.0, 716.0)
        );
    }
}

mod the_cascade {
    use super::*;

    #[test]
    fn steps_every_window_32_px_down_and_right_from_the_top_left_all_the_same_size() {
        let area = arrange_area(1440.0, 900.0, true);
        let rects = cascade_rects(5, area, CASCADE);
        let size = cascade_size(area);
        assert_eq!(size, Size { w: 739.0, h: 389.0 });
        for (i, r) in rects.iter().enumerate() {
            let step = 32.0 * i as f64;
            assert_eq!(*r, Rect::new(area.x + step, area.y + step, size.w, size.h));
        }
    }

    #[test]
    fn starts_a_new_run_at_the_top_moved_right_when_the_next_step_would_leave_the_area() {
        let area = arrange_area(1440.0, 900.0, true);
        let rects = cascade_rects(12, area, CASCADE);
        let first_run: Vec<&Rect> = rects.iter().filter(|r| r.y == area.y).collect();
        assert_eq!(first_run.len(), 2);
        assert_eq!(first_run[1].x, area.x + 7.0 * 32.0);
        for r in &rects {
            assert!(r.x + r.w <= area.x + area.w);
            assert!(r.y + r.h <= area.y + area.h);
        }
        let corners: BTreeSet<(i64, i64)> =
            rects.iter().map(|r| (r.x as i64, r.y as i64)).collect();
        assert_eq!(corners.len(), 12);
    }
}
