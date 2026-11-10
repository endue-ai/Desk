//! Ported from `packages/runtime/src/desktops/migrate.test.ts`: what the four-desktop desk saved
//! loads as four named desktops (ADR 0117), case by case.
//!
//! The TS cases read profiles through `profileMode` and `savedLayout`, which layer the base, the
//! profile and its desktops: that layering stays the profiles' (the core's records), so here the
//! same stored values are read by the functions it calls (`read_recipe`, `read_moved`, ...).

use std::collections::BTreeMap;

use desk_wm::desktops::{default_desktops, id_at};
use desk_wm::migrate::{read_current, read_moved, read_pan, read_recipe, write_list, write_moved};
use desk_wm::{Desk, Desktop, DesktopLayout, DesktopRef, Offset, Saved};
use serde_json::json;

fn desktop(id: &str, name: &str) -> Desktop {
    Desktop {
        id: id.into(),
        name: name.into(),
    }
}

mod four_desktop_data_loads_as_four_named_desktops {
    use super::*;

    fn notes() -> serde_json::Value {
        json!({ "id": "notes", "plugin": "endue.notes", "x": 140, "y": 260, "w": 380, "h": 300, "pinned": false })
    }

    fn calendar() -> serde_json::Value {
        json!({ "id": "calendar", "plugin": "endue.calendar", "x": 120, "y": 240, "w": 380, "h": 300, "pinned": false })
    }

    fn moved_layout() -> serde_json::Value {
        json!({
            "surfaces": [{ "id": "notes", "plugin": "endue.notes", "x": 600, "y": 260, "w": 380, "h": 300, "pinned": false }],
            "eris": { "x": 10, "y": 20 },
            "rail": { "visible": true },
            "drawer": { "visible": false }
        })
    }

    fn moved() -> DesktopLayout {
        serde_json::from_value(moved_layout()).unwrap()
    }

    #[test]
    fn a_profile_saved_by_the_four_desktop_desk_the_same_layouts_on_desktops_named_1_to_4() {
        let recipe = read_recipe(&json!({
            "2": { "surfaces": [calendar()] },
            "4": { "surfaces": [notes()], "eris": { "x": 1, "y": 2 } }
        }));
        // No list: the four a desk starts with, their numbers the ids.
        assert_eq!(recipe.list, None);
        assert_eq!(recipe.layouts.keys().collect::<Vec<_>>(), ["2", "4"]);
        assert_eq!(recipe.layouts["2"]["surfaces"], json!([calendar()]));
        assert_eq!(recipe.layouts["4"]["eris"], json!({ "x": 1, "y": 2 }));
        let session = read_moved(&json!({ "3": moved_layout() }));
        assert_eq!(session.layouts, BTreeMap::from([("3".into(), moved())]));
        // A number still names a desktop by its position.
        let list = default_desktops();
        assert_eq!(
            id_at(&list, &DesktopRef::from(2)),
            id_at(&list, &"2".into())
        );
    }

    #[test]
    fn the_sample_profiles_kept_by_number_load_unchanged() {
        let shell: serde_json::Value =
            serde_json::from_str(include_str!("../../../plugins/shell/plugin.json")).unwrap();
        let morning = shell["contributes"]["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["id"] == "morning")
            .unwrap();
        let recipe = read_recipe(&morning["settings"]["desk.shell.mode"]["desktops"]);
        assert_eq!(recipe.list, None);
        let surfaces = |id: &str| -> Vec<String> {
            recipe.layouts[id]["surfaces"]
                .as_array()
                .unwrap()
                .iter()
                .map(|s| s["id"].as_str().unwrap().to_string())
                .collect()
        };
        assert_eq!(surfaces("2"), ["calendar", "tomorrow"]);
        assert_eq!(surfaces("3"), ["notes"]);
    }

    #[test]
    fn a_session_saved_by_the_four_desktop_desk_its_moved_desktops_by_number_its_pan_its_desktop() {
        let session = read_moved(&json!({ "2": moved_layout(), "9": "not a layout" }));
        assert_eq!(session.list, None);
        assert_eq!(session.layouts, BTreeMap::from([("2".into(), moved())]));
        // JSON writes a NaN as null.
        let pan = read_pan(&json!({
            "1": { "x": -40, "y": 8 }, "2": { "x": null, "y": 0 }, "3": "x"
        }));
        assert_eq!(pan, BTreeMap::from([("1".into(), Offset::new(-40.0, 8.0))]));
        let list = default_desktops();
        assert_eq!(read_current(&json!(3), &list).as_deref(), Some("3"));
        assert_eq!(read_current(&json!(7), &list), None);
        assert_eq!(read_current(&json!("2"), &list).as_deref(), Some("2"));
    }

    #[test]
    fn saving_writes_the_list_and_the_list_loads_the_same_desk_again() {
        let layouts: BTreeMap<String, serde_json::Value> = BTreeMap::from([
            ("2".into(), json!({ "surfaces": [calendar()] })),
            ("3".into(), moved_layout()),
            (
                "4".into(),
                json!({ "surfaces": [notes()], "eris": { "x": 1, "y": 2 } }),
            ),
        ]);
        let written = write_list(&default_desktops(), &layouts);
        let shape: Vec<(&str, &str, bool)> = written
            .iter()
            .map(|d| (d.id.as_str(), d.name.as_str(), d.layout.is_some()))
            .collect();
        assert_eq!(
            shape,
            [
                ("1", "1", false),
                ("2", "2", true),
                ("3", "3", true),
                ("4", "4", true)
            ]
        );
        let again = read_recipe(&serde_json::to_value(&written).unwrap());
        assert_eq!(again.list, Some(default_desktops()));
        let read: BTreeMap<String, serde_json::Value> = again
            .layouts
            .into_iter()
            .map(|(id, l)| (id, serde_json::Value::Object(l)))
            .collect();
        assert_eq!(read, layouts);
    }

    #[test]
    fn a_changed_list_in_the_session_loads_with_its_names_order_and_layouts() {
        let list = vec![
            desktop("3", "Write"),
            desktop("1", "1"),
            desktop("5", "Research"),
        ];
        let stored = write_moved(&list, &BTreeMap::from([("5".into(), moved())]));
        assert_eq!(stored.desktops[2].id, "5");
        assert_eq!(stored.desktops[2].name, "Research");
        assert_eq!(stored.desktops[2].layout, Some(moved()));
        let text = serde_json::to_string(&stored).unwrap();
        let read = read_moved(&serde_json::from_str(&text).unwrap());
        assert_eq!(read.list, Some(list.clone()));
        assert_eq!(read.layouts, BTreeMap::from([("5".into(), moved())]));
        // The profile saved with that list: the same list in the session is nothing to save.
        let mut desk = Desk::new(Saved {
            list: list.clone(),
            ..Saved::default()
        });
        desk.set(|d| d.desktops = Some(list));
        assert!(!desk.dirty());
    }

    #[test]
    fn ignores_what_is_not_a_list_duplicate_ids_entries_that_are_not_desktops() {
        let empty = |v: serde_json::Value| {
            let r = read_recipe(&v);
            r.list.is_none() && r.layouts.is_empty()
        };
        assert!(empty(
            json!([{ "id": "1", "name": "a" }, { "id": "1", "name": "b" }])
        ));
        assert!(empty(json!([{ "name": "no id" }])));
        assert!(empty(json!("nonsense")));
        assert_eq!(
            read_recipe(&json!([{ "id": "x", "name": "" }])).list,
            Some(vec![desktop("x", "x")])
        );
    }
}
