//! The host of windows on the compositor (#81): `Desk::host_plan`, the live budget and the
//! surfaces' lifecycle steps. Ported from what the runtime's host does today and its checks:
//! `surface/host.ts` with `layout.ts` and `edges.ts` (where windows go and the bars float),
//! `frames/live-budget.test.ts` and `policy.test.ts` (the budget), and
//! `packages/runtime/e2e/shell-plugins.spec.ts`'s twenty windows with `desk.surfaces.live` at 8
//! (ADR 0134). The surfaces' steps follow `apps/desk/shell/src/compositor_window/layout.rs`
//! (#52), which they replace, except that a frame moved in the page loads nothing again.

mod common;
#[path = "host/support.rs"]
mod support;

use std::collections::BTreeSet;

use common::{EPOCH, adopt};
use desk_wm::host::{BORDER, PANE_HEAD, TITLE, TITLE_END, TITLE_START};
use desk_wm::{
    Desk, Fill, FrameState, LiveBudget, Offset, Rect, SAFE, Step, Surfaces, TopChrome, Unseen,
    free_area, free_top,
};
use support::*;

mod the_free_area_and_the_bars {
    use super::*;

    #[test]
    fn windows_open_below_eris_between_the_bars_and_a_fill_takes_the_whole_app_under_them() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["endue.notes"]);
        let p = plan(&desk);
        assert_eq!(p.bars.free, free_area(W, H, free_top(true)));
        let notes = p.window("endue.notes").unwrap();
        assert!(notes.rect.x >= SAFE.left && notes.rect.y >= p.bars.free.y);
        // Filled, it takes the whole app; the bars' bands lie over it, where the page draws them.
        desk.toggle_maximize("endue.notes");
        let p = plan(&desk);
        assert_eq!(
            p.window("endue.notes").unwrap().rect,
            Rect::new(0.0, 0.0, W, H)
        );
        assert_eq!(p.window("endue.notes").unwrap().fill, Some(Fill::Full));
        for band in p.bars.bands() {
            assert!(
                p.page.iter().any(|piece| piece.overlaps(&band)),
                "the page is drawn over {band:?}"
            );
        }
    }

    #[test]
    fn eris_moved_away_lets_the_free_area_start_under_the_top_bar() {
        let mut desk = Desk::default();
        desk.move_eris(Some(Offset::new(40.0, 600.0)));
        let p = plan(&desk);
        assert!(!p.bars.eris_home);
        assert_eq!(p.bars.free.y, SAFE.top);
        assert_eq!(p.bars.eris, Rect::new(40.0, 600.0, 128.0, 138.0));
    }

    #[test]
    fn a_filled_window_keeps_its_title_clear_of_the_top_chips() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["endue.notes"]);
        desk.snap_to("endue.notes", Fill::TopLeft);
        let top = TopChrome::measure(W, Some(300.0), Some(1200.0));
        let p = desk.host_plan(W, H, top, &Unseen);
        let w = p.window("endue.notes").unwrap();
        assert_eq!(w.clearance.left, Some(312.0));
        assert_eq!(
            w.clearance.right, None,
            "a top-left quarter ends far from the desktops"
        );
        // Its icon starts at the switcher's edge, and its title after it.
        assert_eq!(w.title_insets().0, 312.0 - 12.0 + TITLE_START + 1.0);
    }
}

mod windows_at_their_rectangles {
    use super::*;

    #[test]
    fn back_to_front_the_focused_window_last_each_pane_in_its_body() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["endue.notes", "endue.mail"]);
        desk.place("endue.notes", Rect::new(200.0, 220.0, 600.0, 400.0));
        desk.set(|d| {
            d.pan.insert("1".into(), Offset::new(-50.0, 10.0));
        });
        desk.focus("endue.notes");
        let p = plan(&desk);
        let ids: Vec<&str> = p.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, ["endue.mail", "endue.notes"]);
        let notes = p.windows.last().unwrap();
        assert!(notes.focused);
        assert_eq!(
            notes.rect,
            Rect::new(150.0, 230.0, 600.0, 400.0),
            "moved by the pan"
        );
        assert_eq!(notes.panes.len(), 1);
        let pane = &notes.panes[0];
        assert_eq!(pane.plugin.as_deref(), Some("endue.notes"));
        assert_eq!(
            pane.rect,
            Rect::new(
                151.0,
                231.0 + TITLE,
                600.0 - 2.0 * BORDER,
                400.0 - 2.0 * BORDER - TITLE
            )
        );
        assert_eq!(p.focused_plugin.as_deref(), Some("endue.notes"));
        assert_eq!(p.seat("endue.notes").size, Some((598.0, 358.0)));
    }

    #[test]
    fn a_split_shows_two_panes_and_the_page_draws_its_own_with_their_window() {
        let mut desk = Desk::default();
        let id = desk.new_window();
        desk.split(desk_wm::SplitDir::Row);
        let p = plan(&desk);
        let w = p.window(&id).unwrap();
        assert_eq!((w.panes.len(), w.dividers.len()), (2, 1));
        assert!(w.panes.iter().all(|pane| pane.plugin.is_none()));
        assert!(w.panes[1].focused, "the new pane takes the focus");
        // The launcher panes and the title bar's icon and tools are the page's; with no window
        // over them, the system layer drawn above the windows is the whole page but the title's
        // text, which the compositor draws.
        let own = w.drawn_by_page();
        assert_eq!(own.len(), 3, "the title bar and both panes");
        let text = w.title_text();
        assert!(p.page.iter().all(|piece| !piece.overlaps(&text)));
        let area: f64 = p.page.iter().map(|r| r.w * r.h).sum();
        assert!((area + text.w * text.h - W * H).abs() < 1e-6);
        assert_eq!(w.title_bar.h, TITLE);
        assert_eq!(w.title_insets(), (1.0 + TITLE_START, 1.0 + TITLE_END));
    }

    #[test]
    fn a_split_plugin_pane_shows_its_surface_under_the_header_the_page_draws() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["e2e.hello"]);
        let alone = plan(&desk).window("e2e.hello").unwrap().panes[0].clone();
        assert_eq!(
            (alone.head, alone.body),
            (None, alone.rect),
            "one pane: no header"
        );
        desk.focus("e2e.hello");
        desk.split(desk_wm::SplitDir::Row);
        let p = plan(&desk);
        let hello = &p.window("e2e.hello").unwrap().panes[0];
        let head = hello.head.unwrap();
        assert_eq!((head.y, head.h), (hello.rect.y, PANE_HEAD));
        assert_eq!(hello.body.y, hello.rect.y + PANE_HEAD);
        assert_eq!(p.seat("e2e.hello").size, Some((hello.body.w, hello.body.h)));
        // The page draws the header, never the surface.
        let w = p.window("e2e.hello").unwrap();
        assert!(w.drawn_by_page().contains(&head));
        assert!(!w.drawn_by_page().contains(&hello.body));
    }

    #[test]
    fn what_the_page_draws_of_a_window_under_another_is_left_out_of_the_layer_above_them() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["endue.notes", "endue.mail"]);
        desk.place("endue.notes", Rect::new(200.0, 200.0, 400.0, 300.0));
        desk.place("endue.mail", Rect::new(300.0, 220.0, 400.0, 300.0));
        desk.focus("endue.mail");
        let p = plan(&desk);
        let notes = p.window("endue.notes").unwrap();
        let mail = p.window("endue.mail").unwrap();
        // Notes's title bar under Mail: that part is drawn with Notes, so Mail covers it.
        let covered = desk_wm::host::intersect(notes.title_bar, mail.rect).unwrap();
        assert_eq!(covered, Rect::new(300.0, 220.0, 299.0, 21.0));
        assert!(p.page.iter().all(|piece| !piece.overlaps(&covered)));
        // Its icon in the open, and Mail's own title bar, are in the layer above every window.
        let open = Rect::new(201.0, 201.0, TITLE_START, 40.0);
        let shown: f64 = (p.page.iter())
            .filter_map(|piece| desk_wm::host::intersect(*piece, open))
            .map(|r| r.w * r.h)
            .sum();
        assert_eq!(shown, open.w * open.h);
        assert!(p.page.iter().any(|piece| piece.overlaps(&mail.title_bar)));
    }

    #[test]
    fn a_window_under_a_fill_is_out_of_sight_and_its_surface_hidden() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["endue.notes", "endue.mail"]);
        let mut surfaces = Surfaces::new();
        let frames = [
            doc("endue.notes", FrameState::Live),
            doc("endue.mail", FrameState::Live),
        ];
        let made = look(&mut surfaces, &desk, &frames);
        assert_eq!(
            kinds(&made),
            ["load", "create", "load", "create"],
            "both in sight"
        );
        desk.toggle_maximize("endue.mail");
        let p = plan(&desk);
        assert_eq!(p.shown, BTreeSet::from(["endue.mail".to_string()]));
        let steps = look(&mut surfaces, &desk, &frames);
        assert!(steps.contains(&Step::Hide {
            surface: host_of("endue.notes")
        }));
        assert!(
            steps
                .iter()
                .any(|s| matches!(s, Step::Resize { surface, size, scale }
            if *surface == host_of("endue.mail") && *size == (1438, 858) && *scale == 2.0))
        );
    }
}

mod never_a_reload {
    use super::*;

    #[test]
    fn a_split_the_drawer_and_a_desktop_switch_move_resize_hide_and_show_only() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["e2e.hello"]);
        let mut surfaces = Surfaces::new();
        let mut frames = vec![doc("e2e.hello", FrameState::Live)];
        assert_eq!(
            kinds(&look(&mut surfaces, &desk, &frames)),
            ["load", "create"]
        );
        let mut seen = Vec::new();
        // Split its window: the page moves the frame (it loads there again); the surface resizes.
        desk.focus("e2e.hello");
        desk.split(desk_wm::SplitDir::Row);
        frames[0].loads += 1;
        seen.extend(look(&mut surfaces, &desk, &frames));
        // Into the drawer and back, each time moved in the page.
        desk.put_away("e2e.hello", "Hello", EPOCH);
        frames[0].loads += 1;
        seen.extend(look(&mut surfaces, &desk, &frames));
        let item = desk.drawer[0].id.clone();
        desk.bring_back(&item);
        frames[0].loads += 1;
        seen.extend(look(&mut surfaces, &desk, &frames));
        // Another desktop and back.
        desk.set_desktop("2");
        seen.extend(look(&mut surfaces, &desk, &frames));
        desk.set_desktop("1");
        seen.extend(look(&mut surfaces, &desk, &frames));
        assert_eq!(
            kinds(&seen),
            ["resize", "hide", "show", "hide", "show"],
            "{seen:?}"
        );
    }

    #[test]
    fn a_new_revision_loads_again_and_a_dead_surface_wakes_when_its_holder_loads_it() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["e2e.hello"]);
        let mut surfaces = Surfaces::new();
        let mut frames = vec![doc("e2e.hello", FrameState::Live)];
        look(&mut surfaces, &desk, &frames);
        frames[0].src.push_str("?rev=2");
        let steps = look(&mut surfaces, &desk, &frames);
        assert_eq!(kinds(&steps), ["load"], "hot reload");
        surfaces.died(&host_of("e2e.hello"));
        assert!(look(&mut surfaces, &desk, &frames).is_empty(), "waits");
        frames[0].loads += 1;
        assert_eq!(kinds(&look(&mut surfaces, &desk, &frames)), ["wake"]);
        assert!(!surfaces.dead(&host_of("e2e.hello")));
        // Released by the runtime: destroyed.
        assert_eq!(
            kinds(&surfaces.apply(&[], |_| plan(&desk).seat(""), 2.0)),
            ["destroy"]
        );
    }

    #[test]
    fn off_screen_every_surface_hides_and_a_new_scale_resizes_them() {
        let mut desk = Desk::default();
        adopt(&mut desk, &["e2e.hello"]);
        let mut surfaces = Surfaces::new();
        let frames = [doc("e2e.hello", FrameState::Live)];
        look(&mut surfaces, &desk, &frames);
        let p = plan(&desk);
        let hid = surfaces.occluded(true, &frames, |id| p.seat(id), 2.0);
        assert_eq!(kinds(&hid), ["hide"]);
        let back = surfaces.occluded(false, &frames, |id| p.seat(id), 1.0);
        assert_eq!(kinds(&back), ["resize", "show"]);
    }
}

#[test]
fn with_twenty_windows_and_eight_live_only_the_visible_and_the_eight_most_recent_keep_a_renderer() {
    const HELLO: &str = "e2e.hello";
    const COUNTER: &str = "e2e.counter";
    let many: Vec<String> = (1..=18).map(|i| format!("test.many-{i}")).collect();
    let ids: Vec<String> = [COUNTER.to_string(), HELLO.to_string()]
        .into_iter()
        .chain(many.iter().cloned())
        .collect();
    let mut desk = Desk::default();
    let mut budget = LiveBudget::new();
    let mut holder = Holder::default();
    let mut surfaces = Surfaces::new();
    for id in &ids {
        desk.adopt(id, id);
        budget.track(id);
    }
    assert_eq!(desk.windows().len(), 20);
    settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    // Hello counts to three; the count lives in what it gives through desk:state.
    desk.focus(HELLO);
    holder.counts.insert(HELLO.into(), 3);
    settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    // Nine windows are focused after it and the ninth fills the app: the other nineteen are out
    // of sight, Hello the ninth most recent of them.
    let recent: Vec<String> = many[..9].to_vec();
    for id in &recent {
        desk.focus(id);
        settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    }
    desk.toggle_maximize(&recent[8]);
    let steps = settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    let mut want = recent.clone();
    want.sort();
    assert_eq!(live(&surfaces), want);
    for id in [HELLO, COUNTER, "test.many-18"] {
        assert!(holder.asleep.contains(id), "{id} sleeps");
        assert!(steps.contains(&Step::Sleep {
            surface: host_of(id)
        }));
    }

    // Focusing Hello wakes it, in front of the window that fills the app, and its count comes
    // back: it is woken, never made or loaded again.
    desk.focus(HELLO);
    let steps = settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    let hello: Vec<&Step> = steps
        .iter()
        .filter(|s| s.surface() == host_of(HELLO))
        .collect();
    assert!(matches!(hello[0], Step::Wake { .. }), "{hello:?}");
    assert!(
        hello
            .iter()
            .all(|s| !matches!(s, Step::Create { .. } | Step::Load { .. }))
    );
    assert_eq!(holder.counts.get(HELLO), Some(&3));
    // Hello gives the keys back to the window that fills the app, which covers it again, then to
    // another sleeping window, in front of the fill: nine out of sight would be live, so the
    // least recent of them sleeps.
    desk.focus(&recent[8]);
    settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    desk.focus("test.many-10");
    settle(&desk, &mut budget, &mut holder, &mut surfaces, &ids);
    let mut want: Vec<String> = [HELLO.to_string(), "test.many-10".to_string()]
        .into_iter()
        .chain(recent[1..].iter().cloned())
        .collect();
    want.sort();
    assert_eq!(live(&surfaces), want);
    assert!(holder.asleep.contains("test.many-1"));
}
