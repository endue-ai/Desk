//! What lies above the windows (#159 findings 15 and 19): what the page draws of a window leaves
//! the system layer's parts out (Eris's figure over a title bar), so a spread's card shows the
//! window, not what floated over it; and the snap preview tints what the page draws of the windows
//! under it, which is then drawn with them rather than above every window.

use desk_wm::host::{cut_out, intersect};
use desk_wm::{Desk, Places, Rect, TopChrome, Unseen};

use super::common::adopt;
use super::support::{H, W};

fn desk_of_two() -> Desk {
    let mut desk = Desk::default();
    adopt(&mut desk, &["endue.notes", "endue.mail"]);
    desk.place("endue.notes", Rect::new(200.0, 100.0, 400.0, 300.0));
    desk.place("endue.mail", Rect::new(700.0, 300.0, 400.0, 300.0));
    desk.focus("endue.mail");
    desk
}

fn area(rects: impl Iterator<Item = Rect>) -> f64 {
    rects.map(|r| r.w * r.h).sum()
}

#[test]
fn a_windows_page_parts_leave_out_the_system_layer_above_it() {
    let desk = desk_of_two();
    // Eris's figure over Notes' title bar.
    let eris = Rect::new(300.0, 60.0, 128.0, 138.0);
    let places = Places {
        over: vec![eris],
        ..Places::default()
    };
    let plain = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &Places::default());
    let p = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &places);
    let notes = p.window("endue.notes").unwrap();
    let before = plain.window("endue.notes").unwrap();
    assert!(before.page_parts.iter().any(|(src, _)| src.overlaps(&eris)));
    assert!(
        notes
            .page_parts
            .iter()
            .all(|(src, dst)| !src.overlaps(&eris) && src == dst)
    );
    // The rest of the title bar is still the page's.
    let cut = intersect(notes.title_bar, eris).unwrap();
    let kept = area(notes.page_parts.iter().map(|(src, _)| *src));
    let had = area(before.page_parts.iter().map(|(src, _)| *src));
    assert_eq!(kept, had - cut.w * cut.h);
    // The window under nothing keeps all its parts.
    assert_eq!(
        p.window("endue.mail").unwrap().page_parts,
        plain.window("endue.mail").unwrap().page_parts
    );
}

#[test]
fn a_part_moved_ahead_of_the_page_is_cut_where_the_page_shows_it() {
    let parts = vec![(
        Rect::new(100.0, 100.0, 200.0, 40.0),
        Rect::new(400.0, 300.0, 200.0, 40.0),
    )];
    let hole = Rect::new(150.0, 90.0, 50.0, 100.0);
    let cut = cut_out(&parts, &[hole]);
    assert_eq!(cut.len(), 2);
    for (src, dst) in &cut {
        assert!(!src.overlaps(&hole));
        assert_eq!(
            (dst.x - src.x, dst.y - src.y, dst.w, dst.h),
            (300.0, 200.0, src.w, src.h)
        );
    }
    assert_eq!(cut_out(&parts, &[]), parts);
}

#[test]
fn the_snap_preview_tints_the_tools_of_the_windows_under_it() {
    let desk = desk_of_two();
    // Mail dragged to the left edge: the preview over the left half, Notes under it.
    let half = Rect::new(0.0, 0.0, 714.0, 900.0);
    let places = Places {
        preview: Some((half, "endue.mail".into())),
        ..Places::default()
    };
    let plain = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &Places::default());
    let p = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &places);
    let notes = p.window("endue.notes").unwrap().title_bar;
    let tinted = intersect(notes, half).unwrap();
    assert!(plain.page.iter().any(|piece| piece.overlaps(&tinted)));
    assert!(p.page.iter().all(|piece| !piece.overlaps(&tinted)));
    // The window it lies under keeps its own parts above it.
    let mail = p.window("endue.mail").unwrap().title_bar;
    assert!(p.page.iter().any(|piece| piece.overlaps(&mail)));
    // A preview for a window not on the desktop changes nothing.
    let gone = Places {
        preview: Some((half, "endue.chat".into())),
        ..Places::default()
    };
    let same = desk.host_plan_at(W, H, TopChrome::default(), &Unseen, &gone);
    assert_eq!(same.page, plain.page);
}
