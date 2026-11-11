//! Ported from `packages/runtime/src/shell/away.test.ts` (the drawer holds only what is away, #4)
//! and `shell/actions.test.ts` ("the drawer", "agent screens"), case by case; also the recent
//! items' ages of `shell/Drawer.ts` (fading after 12 h, gone after 24 h), which had no unit test,
//! on an injected clock, and bringing an item back (`raise`).
//!
//! The TS cases switch profiles through `switched` over `Mode`s; here a profile is what the window
//! manager reads of it, its desktops and their saved layouts (`Saved`). `actions.test.ts`'s
//! `surfaceTitle` case is the shell's copy: the drawer takes the name it is given.

mod common;

use std::collections::BTreeMap;

use common::*;
use desk_wm::drawer::{recent_fade, shown};
use desk_wm::{Desk, DrawerItem, DrawerKind, Offset, Placement, Saved, default_placement};

/// A profile over the base that lays `surfaces` on desktop 2.
fn profile(surfaces: Vec<Placement>) -> Saved {
    Saved {
        desktops: BTreeMap::from([("2".into(), layout(surfaces))]),
        ..Saved::default()
    }
}

fn morning() -> Saved {
    profile(vec![default_placement("calendar")])
}

fn focus() -> Saved {
    profile(vec![])
}

/// The sample desk with Morning in force.
fn desk() -> Desk {
    let mut desk = Desk::new(morning());
    desk.set(|d| d.drawer = sample_drawer(EPOCH));
    desk
}

/// The shell's copy for a put-away window, as the tests' `tr` gives it: the id.
fn title(id: &str) -> String {
    id.to_string()
}

fn in_drawer(placement: Placement) -> DrawerItem {
    DrawerItem {
        id: format!("surface-{}", placement.id),
        kind: DrawerKind::Surface,
        name: placement.id.clone(),
        at: EPOCH,
        placement: Some(placement),
    }
}

mod the_drawer_holds_only_what_is_away {
    use super::*;

    #[test]
    fn lets_go_of_a_surface_when_a_profile_that_places_it_is_in_force_again() {
        // Opened in the session under Focus, which places nothing: a switch puts it away.
        let mut c = Desk::new(focus());
        c.set(|d| d.drawer = sample_drawer(EPOCH));
        c.edit_at("2", |l| l.surfaces.push(default_placement("calendar")));
        c.switch_profile(focus(), title, EPOCH + 1000);
        assert!(drawer_ids(&c).contains(&"calendar".into()));
        c.switch_profile(morning(), title, EPOCH + 2000);
        assert_eq!(ids(&c.layout_of("2").surfaces), ["calendar"]);
        assert!(!drawer_ids(&c).contains(&"calendar".into()));
    }

    #[test]
    fn holds_none_of_the_windows_of_the_profile_left_which_leave_with_it() {
        let mut c = desk();
        c.switch_profile(focus(), title, EPOCH + 1000);
        assert_eq!(
            drawer_ids(&c),
            ["file-brief", "recent-weather", "recent-summary"]
        );
    }

    #[test]
    fn lets_go_of_a_surface_a_layout_places_on_another_desktop() {
        let mut c = desk();
        c.open_surface("notes", None);
        c.put_away("notes", "notes", EPOCH + 1000);
        assert!(drawer_ids(&c).contains(&"notes".into()));
        c.edit_at("3", |l| l.surfaces.push(default_placement("notes")));
        assert!(!drawer_ids(&c).contains(&"notes".into()));
    }

    #[test]
    fn drops_a_placed_surface_from_a_drawer_that_comes_back_from_a_saved_session() {
        let mut c = desk();
        c.set(|d| d.drawer.insert(0, in_drawer(default_placement("calendar"))));
        assert!(!drawer_ids(&c).contains(&"calendar".into()));
    }

    #[test]
    fn starts_without_a_placed_surface_in_the_drawer_it_was_seeded_with() {
        let mut seeded = vec![in_drawer(default_placement("calendar"))];
        seeded.extend(sample_drawer(EPOCH));
        let desk = Desk {
            drawer: seeded,
            ..Desk::new(morning())
        }
        .settled();
        assert_eq!(
            drawer_ids(&desk),
            ["file-brief", "recent-weather", "recent-summary"]
        );
    }

    #[test]
    fn keeps_what_is_away_a_stashed_surface_files_and_recent_items() {
        let mut c = desk();
        c.open_surface("notes", None);
        c.put_away("notes", "notes", EPOCH + 1000);
        assert_eq!(
            drawer_ids(&c),
            ["notes", "file-brief", "recent-weather", "recent-summary"]
        );
    }
}

mod the_drawer {
    use super::*;

    #[test]
    fn names_a_put_away_surface_after_its_title_and_dates_it_from_the_wall_clock() {
        let mut c = sample(EPOCH);
        c.open_surface("calendar", None);
        c.put_away("calendar", "surfaceCalendar", EPOCH + 1000);
        let first = &c.drawer[0];
        assert_eq!(first.kind, DrawerKind::Surface);
        assert_eq!(first.name, "surfaceCalendar");
        assert_eq!(first.at, EPOCH + 1000);
        assert!(c.layout().surfaces.is_empty());
    }

    #[test]
    fn a_window_put_away_again_is_in_the_drawer_once_first() {
        let mut c = sample(EPOCH);
        c.open_surface("notes", None);
        c.put_away("notes", "Notes", EPOCH + 1000);
        c.bring_back("surface-notes");
        c.put_away("notes", "Notes", EPOCH + 2000);
        assert_eq!(drawer_ids(&c)[..2], ["notes", "file-brief"]);
        assert_eq!(c.drawer[0].at, EPOCH + 2000);
    }
}

mod agent_screens {
    use super::*;

    #[test]
    fn open_the_second_one_offset_from_the_first_instead_of_on_top_of_it() {
        let mut c = sample(EPOCH);
        c.open_surface("agent:ag_1", None);
        c.open_surface("agent:ag_2", None);
        let surfaces = c.layout().surfaces;
        assert_eq!(surfaces[1].x, surfaces[0].x + 24.0);
        assert_eq!(surfaces[1].y, surfaces[0].y + 24.0);
    }
}

mod recent_items {
    use super::*;

    #[test]
    fn start_fading_after_12_h_and_are_gone_after_24_h() {
        assert_eq!(recent_fade(0), 1.0);
        assert_eq!(recent_fade(12 * HOUR), 1.0);
        assert_eq!(recent_fade(18 * HOUR), 0.5);
        assert_eq!(recent_fade(24 * HOUR), 0.0);
        assert_eq!(recent_fade(30 * HOUR), 0.0);
        let drawer = sample_drawer(EPOCH);
        let names = |now: i64| -> Vec<String> {
            shown(&drawer, now)
                .into_iter()
                .map(|d| d.id.clone())
                .collect()
        };
        assert_eq!(
            names(EPOCH),
            ["file-brief", "recent-weather", "recent-summary"]
        );
        // Seven hours on, the summary is 25 hours old; a file stays however old it is.
        assert_eq!(names(EPOCH + 7 * HOUR), ["file-brief", "recent-weather"]);
        assert_eq!(names(EPOCH + 100 * HOUR), ["file-brief"]);
    }
}

mod bringing_back {
    use super::*;

    #[test]
    fn a_put_away_window_comes_back_where_it_was_and_in_use() {
        let mut c = sample(EPOCH);
        c.open_surface("notes", None);
        c.move_surface("notes", Offset::new(300.0, 400.0));
        c.put_away("notes", "Notes", EPOCH + 1000);
        c.set(|d| d.focused = None);
        c.bring_back("surface-notes");
        let notes = &c.layout().surfaces[0];
        assert_eq!((notes.x, notes.y), (300.0, 400.0));
        assert_eq!(c.focused.as_deref(), Some("notes"));
        assert!(!drawer_ids(&c).contains(&"notes".into()));
        // Nothing in the drawer by that id: nothing happens.
        c.bring_back("surface-notes");
        assert_eq!(c.layout().surfaces.len(), 1);
    }

    #[test]
    fn a_recent_item_comes_back_as_erises_screen_and_a_file_as_its_view() {
        let mut c = sample(EPOCH);
        c.bring_back("recent-weather");
        c.bring_back("file-brief");
        let opened: Vec<(String, String)> = c
            .layout()
            .surfaces
            .iter()
            .map(|p| (p.id.clone(), p.plugin.clone()))
            .collect();
        assert_eq!(
            opened,
            [
                ("recent:recent-weather".into(), "endue.eris".into()),
                ("file:brief.pdf".into(), "endue.files".into()),
            ]
        );
        assert_eq!(drawer_ids(&c), ["recent-summary"]);
    }
}
