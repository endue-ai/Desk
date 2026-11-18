//! Ported from `packages/runtime/src/buffers.test.ts` (the buffer list), case by case, and the
//! focus rules of `shell/windows.ts` (`focusPane`) and `policies/display.ts`
//! (`desk.display.focus-next` and `focus-previous` over the host's views and the runtime's
//! surfaces), which had no unit test of their own and gain cases here.
//!
//! `buffers.test.ts`'s "tells listeners about every change" counts listener calls; the model has
//! no listeners, so every change moves its revision on and the host tells whoever listens.
//! `opener` (in "opener and baseName") is the files policy's, not the window manager's.

mod common;

use common::*;
use desk_wm::Desk;
use desk_wm::buffers::{Buffer, BufferPatch, Buffers, base_name};

fn buffer(id: &str, plugin: &str) -> Buffer {
    Buffer {
        id: id.into(),
        name: id.into(),
        plugin: plugin.into(),
        path: None,
        modified: false,
        surface: false,
    }
}

fn listed(list: &Buffers) -> Vec<String> {
    list.list().into_iter().map(|b| b.id).collect()
}

mod buffers {
    use super::*;

    #[test]
    fn keeps_the_order_buffers_were_used_in_most_recent_first() {
        let mut list = Buffers::default();
        list.add(buffer("a", "p"));
        list.add(buffer("b", "p"));
        list.touch("b");
        list.touch("a");
        assert_eq!(listed(&list), ["a", "b"]);
        assert_eq!(list.current().map(|b| b.id).as_deref(), Some("a"));
        list.remove("a");
        assert_eq!(list.current().map(|b| b.id).as_deref(), Some("b"));
    }

    #[test]
    fn finds_buffers_by_path_and_plugin_and_updates_them() {
        let mut list = Buffers::default();
        list.add(Buffer {
            path: Some("~/a.md".into()),
            ..buffer("file:~/a.md", "example.notes")
        });
        list.add(buffer("surface:example.chat", "example.chat"));
        assert_eq!(
            list.by_path("~/a.md").map(|b| b.id).as_deref(),
            Some("file:~/a.md")
        );
        let chat: Vec<String> = list
            .of_plugin("example.chat")
            .into_iter()
            .map(|b| b.id)
            .collect();
        assert_eq!(chat, ["surface:example.chat"]);
        let modified = BufferPatch {
            modified: Some(true),
            ..BufferPatch::default()
        };
        assert_eq!(
            list.update("file:~/a.md", modified.clone())
                .map(|b| b.modified),
            Some(true)
        );
        assert!(list.update("missing", modified).is_none());
    }

    #[test]
    fn steps_through_buffers_in_a_stable_order_wrapping_around() {
        let mut list = Buffers::default();
        for (id, plugin) in [("b", "p2"), ("a", "p1"), ("c", "p2")] {
            list.add(buffer(id, plugin));
        }
        let step = |from: Option<&str>, by: i64| list.step(from, by).map(|b| b.id);
        assert_eq!(step(Some("a"), 1).as_deref(), Some("b"));
        assert_eq!(step(Some("c"), 1).as_deref(), Some("a"));
        assert_eq!(step(Some("a"), -1).as_deref(), Some("c"));
        assert_eq!(step(None, 1).as_deref(), Some("a"));
        assert!(Buffers::default().step(None, 1).is_none());
    }

    #[test]
    fn tells_listeners_about_every_change() {
        let mut list = Buffers::default();
        let start = list.revision();
        list.add(buffer("a", "p"));
        list.update(
            "a",
            BufferPatch {
                name: Some("A".into()),
                ..BufferPatch::default()
            },
        );
        list.remove("a");
        assert_eq!(list.revision() - start, 3);
        // Nothing to change changes nothing.
        list.touch("missing");
        list.remove("missing");
        assert_eq!(list.revision() - start, 3);
    }

    #[test]
    fn names_a_path_by_its_last_part() {
        assert_eq!(base_name("~/notes/a.md"), "a.md");
        assert_eq!(base_name("/tmp/dir/"), "dir");
        assert_eq!(base_name("~"), "~");
    }
}

/// Calendar and Notes placed on desktop 1, two plugin windows in their slots, the second moved to
/// desktop 2; Notes in use.
fn desk() -> Desk {
    let mut desk = sample(EPOCH);
    desk.open_surface("calendar", None);
    desk.open_surface("notes", None);
    adopt(&mut desk, &["p.a", "p.b"]);
    desk.move_to_desktop("p.b", "2", None);
    desk
}

mod focus_cycling {
    use super::*;

    #[test]
    fn the_order_is_the_shells_own_panes_then_the_plugin_surfaces_in_sight() {
        let mut desk = desk();
        assert_eq!(desk.focus_order(), ["calendar/p1", "notes/p1", "p.a"]);
        assert_eq!(desk.focused_id().as_deref(), Some("notes/p1"));
        // A window's tabs are one stop, the tab it shows: the others are its window's to show.
        desk.adopt("p.a@2", "A", desk_wm::FREE);
        desk.add_tab("p.a", "plugin:p.a@2")
            .expect("a tab of its kind");
        assert_eq!(desk.focus_order(), ["calendar/p1", "notes/p1", "p.a@2"]);
        assert_eq!(desk.focused_id().as_deref(), Some("p.a@2"));
    }

    #[test]
    fn next_and_previous_step_through_it_wrapping_around() {
        let mut desk = desk();
        assert_eq!(desk.focus_next(1).as_deref(), Some("p.a"));
        assert_eq!(desk.focused.as_deref(), Some("p.a"));
        assert_eq!(desk.tab.as_deref(), Some("p1"));
        assert_eq!(desk.focused_plugin().as_deref(), Some("p.a"));
        assert_eq!(desk.focus_next(1).as_deref(), Some("calendar/p1"));
        assert_eq!(desk.focused.as_deref(), Some("calendar"));
        assert_eq!(desk.focused_plugin(), None);
        assert_eq!(desk.focus_next(-1).as_deref(), Some("p.a"));
    }

    #[test]
    fn from_no_focus_the_next_is_the_first_and_an_empty_desk_has_none() {
        let mut desk = desk();
        desk.set(|d| {
            d.focused = None;
            d.tab = None;
        });
        assert_eq!(desk.focused_id(), None);
        assert_eq!(desk.focus_next(1).as_deref(), Some("calendar/p1"));
        assert_eq!(Desk::default().focus_next(1), None);
    }

    #[test]
    fn a_plugin_surface_takes_the_focus_through_the_window_that_shows_it_even_on_another_desktop() {
        let mut desk = desk();
        desk.focus("p.b");
        assert_eq!(desk.desktop, "2");
        assert_eq!(desk.focused.as_deref(), Some("p.b"));
        assert_eq!(desk.focused_plugin().as_deref(), Some("p.b"));
        desk.focus("calendar/p1");
        assert_eq!(desk.desktop, "2", "a pane is focused only where it is");
        assert_eq!(desk.focused.as_deref(), Some("p.b"));
    }
}

mod focusing_a_pane {
    use super::*;

    #[test]
    fn the_tab_a_window_shows_when_none_or_a_missing_one_is_named() {
        let mut desk = desk();
        desk.adopt("p.a@2", "A", desk_wm::FREE);
        desk.add_tab("p.a", "plugin:p.a@2")
            .expect("a tab of its kind");
        assert_eq!(desk.tab.as_deref(), Some("p2"));
        // Naming none keeps the tab it shows; naming one shows it.
        desk.focus_tab("p.a", None);
        assert_eq!(desk.tab.as_deref(), Some("p2"));
        desk.focus_tab("p.a", Some("p1"));
        assert_eq!(desk.tab.as_deref(), Some("p1"));
        assert_eq!(desk.focused_plugin().as_deref(), Some("p.a"));
        desk.focus_tab("p.a", Some("p9"));
        assert_eq!(desk.tab.as_deref(), Some("p1"));
    }

    #[test]
    fn a_pane_showing_a_plugins_surface_hands_that_plugin_the_keys() {
        let mut desk = desk();
        desk.focus_tab("p.a", None);
        assert_eq!(desk.focused_plugin().as_deref(), Some("p.a"));
        assert_eq!(desk.focused_window().as_deref(), Some("p.a"));
        desk.focus_tab("calendar", None);
        assert_eq!(desk.focused_plugin(), None);
    }

    #[test]
    fn a_window_not_on_the_desktop_in_front_takes_no_focus() {
        let mut desk = desk();
        desk.focus_tab("p.b", None);
        assert_eq!(desk.focused.as_deref(), Some("notes"));
        assert_eq!(desk.desktop, "1");
    }
}
