//! Ported from `packages/runtime/src/surface/placed.test.ts`: the shell wakes the plugins its
//! windows place (#590). One that started asleep has no surface, and a window showing only plugins
//! the runtime does not hold is not drawn.
//!
//! The TS case watches the store and counts the runtime's `wake` calls; the model is what it asks:
//! the plugins a desktop's layout places, each once. Waking them as the desktop in front changes,
//! and stopping when the watch is off, is the host's wiring (#81).

use desk_wm::{Placement, Rect, Tab, placed_plugins};

fn at(id: &str, plugin: &str) -> Placement {
    Placement::new(id, plugin, Rect::new(100.0, 100.0, 400.0, 300.0))
}

mod wake_placed {
    use super::*;

    #[test]
    fn the_windows_of_the_desktop_in_front_wake_the_plugins_they_place_once_asked_and_as_the_layout_changes()
     {
        let first = vec![
            // A profile's window named after its surface shows the plugin it names.
            at("terminal", "endue.terminal"),
            Placement {
                tabs: Some(vec![
                    Tab::new("p1", "plugin:endue.git"),
                    Tab::new("p2", "plugin:endue.git@2"),
                ]),
                ..at("window-1", "endue.window")
            },
        ];
        let second = vec![Placement {
            tabs: Some(vec![Tab::new("p1", "plugin:endue.mail")]),
            ..at("mail", "endue.mail")
        }];
        assert_eq!(
            placed_plugins(&first),
            ["endue.terminal", "endue.window", "endue.git", "endue.git@2"]
        );
        // The desktop with Mail comes to the front: its window wakes Mail, once.
        assert_eq!(placed_plugins(&second), ["endue.mail"]);
    }
}
