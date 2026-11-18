//! A window's tabs (ADR 0268): a plugin's window takes further windows of that plugin as tabs and
//! nothing else, shows one tab at a time, and closes tab by tab. A layout saved while a window
//! split inside reads as tabs.

mod common;

use common::{EPOCH, adopt, sample};
use desk_wm::edits::{Edit, Kept, apply};
use desk_wm::{Desk, FREE, Placement, Size, Tab};
use serde_json::{Value, json};

const SCREEN: Size = Size {
    w: 1440.0,
    h: 900.0,
};

/// A desk with Terminal and Notes in their slots, and Terminal's second window handed over.
fn desk() -> Desk {
    let mut desk = sample(EPOCH);
    adopt(&mut desk, &["endue.terminal", "endue.notes"]);
    desk.adopt("endue.terminal@2", "Terminal", FREE);
    desk
}

fn window(desk: &Desk, id: &str) -> Placement {
    desk.window(id).expect("the window")
}

fn views(p: &Placement) -> Vec<String> {
    p.tabs().into_iter().map(|t| t.view).collect()
}

fn edit(desk: &mut Desk, value: Value) -> Value {
    let edit: Edit = serde_json::from_value(value).expect("an edit");
    apply(desk, &mut Kept::default(), &edit, SCREEN)
}

mod adding_a_tab {
    use super::*;

    #[test]
    fn a_plugins_window_takes_another_window_of_that_plugin_and_shows_it() {
        let mut desk = desk();
        let added = desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        assert_eq!(added.as_deref(), Some("p2"));
        let p = window(&desk, "endue.terminal");
        assert_eq!(
            views(&p),
            ["plugin:endue.terminal", "plugin:endue.terminal@2"]
        );
        assert_eq!(p.shown().id, "p2");
        assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
        assert_eq!(desk.tab.as_deref(), Some("p2"));
        assert_eq!(desk.focused_plugin().as_deref(), Some("endue.terminal@2"));
    }

    #[test]
    fn the_new_window_is_a_tab_and_no_window_of_its_own() {
        let mut desk = desk();
        // Handed over with no tab to go to, it has a slot of its own.
        assert!(desk.window("endue.terminal@2").is_some());
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        assert!(desk.window("endue.terminal@2").is_none());
        let ids: Vec<String> = desk.windows().into_iter().map(|p| p.id).collect();
        assert_eq!(ids.len(), 2, "{ids:?}");
    }

    #[test]
    fn a_window_takes_no_tab_of_another_plugin() {
        let mut desk = desk();
        for view in ["plugin:endue.notes", "plugin:endue.notes@2", "calendar"] {
            assert_eq!(desk.add_tab("endue.terminal", view), None, "{view}");
        }
        assert_eq!(views(&window(&desk, "endue.terminal")).len(), 1);
    }

    #[test]
    fn a_window_takes_no_tab_it_already_shows() {
        let mut desk = desk();
        assert_eq!(
            desk.add_tab("endue.terminal", "plugin:endue.terminal"),
            None
        );
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        let again = desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        assert_eq!(again, None);
    }

    #[test]
    fn a_window_of_the_shells_own_view_takes_no_tab() {
        let mut desk = desk();
        let launcher = desk.new_window();
        assert_eq!(desk.tab_kind(&window(&desk, &launcher)), None);
        for view in ["launcher", "plugin:endue.terminal@2"] {
            assert_eq!(desk.add_tab(&launcher, view), None, "{view}");
        }
    }

    #[test]
    fn a_tab_goes_right_after_the_one_shown() {
        let mut desk = desk();
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        desk.focus_tab("endue.terminal", Some("p1"));
        desk.adopt("endue.terminal@3", "Terminal", FREE);
        desk.add_tab("endue.terminal", "plugin:endue.terminal@3");
        let p = window(&desk, "endue.terminal");
        let ids: Vec<String> = p.tabs().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["p1", "p3", "p2"]);
    }

    #[test]
    fn the_edit_answers_the_tabs_id_or_null() {
        let mut desk = desk();
        let add = |view: &str| json!({ "op": "add-tab", "window": "endue.terminal", "view": view });
        assert_eq!(edit(&mut desk, add("plugin:endue.terminal@2")), json!("p2"));
        assert_eq!(edit(&mut desk, add("plugin:endue.notes")), Value::Null);
    }
}

mod showing_and_closing {
    use super::*;

    /// Terminal's window with three tabs, the last one shown.
    fn three() -> Desk {
        let mut desk = desk();
        desk.adopt("endue.terminal@3", "Terminal", FREE);
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        desk.add_tab("endue.terminal", "plugin:endue.terminal@3");
        desk
    }

    #[test]
    fn stepping_shows_the_next_tab_and_wraps_around() {
        let mut desk = three();
        let shown = |desk: &Desk| window(desk, "endue.terminal").shown().id;
        assert_eq!(shown(&desk), "p3");
        desk.step_tab(1);
        assert_eq!(shown(&desk), "p1");
        desk.step_tab(-1);
        assert_eq!(shown(&desk), "p3");
        edit(&mut desk, json!({ "op": "step-tab", "step": -1 }));
        assert_eq!(shown(&desk), "p2");
        assert_eq!(desk.focused_plugin().as_deref(), Some("endue.terminal@2"));
    }

    #[test]
    fn revealing_a_plugins_window_shows_its_tab() {
        let mut desk = three();
        desk.focus("endue.notes");
        desk.show_plugin("endue.terminal@2");
        assert_eq!(desk.focused.as_deref(), Some("endue.terminal"));
        assert_eq!(window(&desk, "endue.terminal").shown().id, "p2");
    }

    #[test]
    fn closing_the_tab_shown_shows_the_next_and_answers_its_plugin() {
        let mut desk = three();
        desk.focus_tab("endue.terminal", Some("p2"));
        let gone = desk.close_tab(None, None);
        assert_eq!(gone, ["endue.terminal@2"]);
        let p = window(&desk, "endue.terminal");
        assert_eq!(p.shown().id, "p3");
        assert_eq!(desk.focused_plugin().as_deref(), Some("endue.terminal@3"));
    }

    #[test]
    fn closing_a_tab_out_of_sight_keeps_the_tab_shown() {
        let mut desk = three();
        let gone = desk.close_tab(Some("endue.terminal"), Some("p2"));
        assert_eq!(gone, ["endue.terminal@2"]);
        assert_eq!(window(&desk, "endue.terminal").shown().id, "p3");
    }

    #[test]
    fn closing_a_plugins_first_tab_leaves_the_window_to_the_others() {
        let mut desk = three();
        let answer = edit(
            &mut desk,
            json!({ "op": "close-tab", "window": "endue.terminal", "tab": "p1" }),
        );
        assert_eq!(answer, json!(["endue.terminal"]));
        // The plugin's first window is released; the window stays, showing the tabs left.
        assert!(!desk.holds("endue.terminal"));
        let p = window(&desk, "endue.terminal");
        assert_eq!(
            views(&p),
            ["plugin:endue.terminal@2", "plugin:endue.terminal@3"]
        );
        assert_eq!(desk.tab_kind(&p).as_deref(), Some("endue.terminal"));
    }

    #[test]
    fn the_last_tab_closes_its_window() {
        let mut desk = desk();
        desk.focus("endue.notes");
        assert_eq!(desk.close_tab(None, None), ["endue.notes"]);
        assert_eq!(desk.focused, None);
    }

    #[test]
    fn closing_the_window_answers_every_tabs_plugin() {
        let mut desk = three();
        let gone = desk.close_window("endue.terminal");
        assert_eq!(
            gone,
            ["endue.terminal", "endue.terminal@2", "endue.terminal@3"]
        );
    }
}

mod tabs_follow_their_plugins_windows {
    use super::*;

    #[test]
    fn a_tab_is_there_once_its_plugins_window_is_handed_over() {
        let mut desk = sample(EPOCH);
        adopt(&mut desk, &["endue.terminal"]);
        // The tab is asked for before its window arrives: the window shows what it showed.
        assert!(
            desk.add_tab("endue.terminal", "plugin:endue.terminal@2")
                .is_some()
        );
        assert_eq!(window(&desk, "endue.terminal").shown().id, "p1");
        assert_eq!(desk.tab.as_deref(), Some("p1"));
        desk.adopt("endue.terminal@2", "Terminal", FREE);
        let p = window(&desk, "endue.terminal");
        assert_eq!((p.tabs().len(), p.shown().id.as_str()), (2, "p2"));
        assert_eq!(desk.tab.as_deref(), Some("p2"));
        assert!(desk.window("endue.terminal@2").is_none(), "never a window");
    }

    #[test]
    fn a_tab_goes_with_its_plugins_window() {
        let mut desk = desk();
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        // Its plugin closed it (Mod+W on its surface): the window shows the tab left.
        desk.release("endue.terminal@2");
        let p = window(&desk, "endue.terminal");
        assert_eq!(views(&p), ["plugin:endue.terminal"]);
        assert_eq!(p.shown().id, "p1");
        assert_eq!(desk.tab.as_deref(), Some("p1"));
        assert_eq!(desk.focused_plugin().as_deref(), Some("endue.terminal"));
    }

    #[test]
    fn a_plugins_first_window_comes_back_to_the_window_named_after_it_as_a_tab() {
        let mut desk = desk();
        desk.add_tab("endue.terminal", "plugin:endue.terminal@2");
        let gone = desk.close_tab(Some("endue.terminal"), Some("p1"));
        assert_eq!(gone, ["endue.terminal"]);
        desk.release("endue.terminal");
        // The plugin opens its first window again: one window still, with it as a tab.
        desk.adopt("endue.terminal", "Terminal", FREE);
        let named: Vec<Placement> = (desk.windows().into_iter())
            .filter(|p| p.id == "endue.terminal")
            .collect();
        assert_eq!(named.len(), 1);
        assert_eq!(
            views(&named[0]),
            ["plugin:endue.terminal@2", "plugin:endue.terminal"]
        );
        assert_eq!(named[0].shown().id, "p2", "it shows what it showed");
    }
}

mod saved_layouts {
    use super::*;

    #[test]
    fn a_window_saved_split_inside_reads_as_tabs_first_pane_first() {
        let saved = json!({
            "id": "window-1", "plugin": "endue.window",
            "x": 0, "y": 0, "w": 480, "h": 320, "pinned": false,
            "panes": {
                "kind": "split", "id": "s2", "dir": "row", "ratio": 0.4,
                "a": { "kind": "view", "id": "p1", "view": "launcher" },
                "b": {
                    "kind": "split", "id": "s3", "dir": "column", "ratio": 0.5,
                    "a": { "kind": "view", "id": "p2", "view": "calendar" },
                    "b": { "kind": "view", "id": "p3", "view": "plugin:endue.notes" }
                }
            }
        });
        let p: Placement = serde_json::from_value(saved).expect("a placement");
        assert_eq!(
            p.tabs(),
            [
                Tab::new("p1", "launcher"),
                Tab::new("p2", "calendar"),
                Tab::new("p3", "plugin:endue.notes"),
            ]
        );
        assert_eq!(p.shown().id, "p1");
        // It writes tabs from now on, and reads them back.
        let written = serde_json::to_value(&p).unwrap();
        assert!(written.get("panes").is_none());
        assert_eq!(written["tabs"][2]["view"], "plugin:endue.notes");
        assert_eq!(serde_json::from_value::<Placement>(written).unwrap(), p);
    }

    #[test]
    fn a_window_saved_with_one_pane_or_none_is_one_tab() {
        let one = json!({
            "id": "mail", "plugin": "endue.mail",
            "x": 0, "y": 0, "w": 480, "h": 320, "pinned": false,
            "panes": { "kind": "view", "id": "p1", "view": "plugin:endue.mail" }
        });
        let p: Placement = serde_json::from_value(one).expect("a placement");
        assert_eq!(p.tabs(), [Tab::new("p1", "plugin:endue.mail")]);
        let none = json!({
            "id": "calendar", "plugin": "endue.calendar",
            "x": 0, "y": 0, "w": 480, "h": 320, "pinned": false
        });
        let p: Placement = serde_json::from_value(none).expect("a placement");
        assert_eq!(p.tabs(), [Tab::new("p1", "calendar")]);
        assert!(serde_json::to_value(&p).unwrap().get("tabs").is_none());
    }

    #[test]
    fn a_window_of_mixed_tabs_from_a_saved_split_takes_no_more() {
        let mut desk = desk();
        let id = desk.new_window();
        desk.update(&id, |p| {
            p.tabs = Some(vec![
                Tab::new("p1", "plugin:endue.terminal"),
                Tab::new("p2", "plugin:endue.notes"),
            ]);
        });
        assert_eq!(desk.tab_kind(&window(&desk, &id)), None);
        assert_eq!(desk.add_tab(&id, "plugin:endue.terminal@2"), None);
    }
}
