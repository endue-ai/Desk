use desk_wm::{Adopted, Desk, Rect, TopChrome, Unseen};

use super::{Registry, Switch, drawn};

#[test]
fn the_switch_names_plugins_by_id_separated_by_commas() {
    let on = Switch::parse(Some(" endue.terminal , endue.notes,,"));
    assert!(on.is_on());
    assert!(on.has("endue.terminal"));
    assert!(on.has("endue.notes"));
    assert!(!on.has("endue.mail"));
    assert!(!on.has("endue"), "a whole id, never a prefix");
    assert!(!on.has(""));
    assert_eq!(
        Switch::parse(Some("endue.terminal")),
        Switch::parse(Some("endue.terminal,"))
    );
}

#[test]
fn the_switch_unset_or_empty_is_off() {
    for value in [None, Some(""), Some(" "), Some(",, ,")] {
        let off = Switch::parse(value);
        assert!(!off.is_on(), "{value:?}");
        assert!(!off.has("endue.terminal"), "{value:?}");
    }
}

/// A desk of two plugin windows, the terminal's and Notes'.
fn desk() -> Desk {
    let mut desk = Desk::default();
    desk.set(|d| {
        d.adopted = ["endue.terminal", "endue.notes"]
            .iter()
            .enumerate()
            .map(|(slot, id)| Adopted {
                id: (*id).into(),
                title: (*id).into(),
                slot: Some(slot),
                at: None,
                area: None,
            })
            .collect();
    });
    desk.place("endue.terminal", Rect::new(100.0, 100.0, 500.0, 300.0));
    desk.place("endue.notes", Rect::new(700.0, 100.0, 400.0, 300.0));
    desk
}

#[test]
fn the_compositor_draws_nothing_where_a_plugin_has_an_os_window() {
    let plan = desk().host_plan(1440.0, 900.0, TopChrome::default(), &Unseen);
    let ids = |p: &desk_wm::Plan| p.windows.iter().map(|w| w.id.clone()).collect::<Vec<_>>();
    assert_eq!(ids(&plan).len(), 2);
    let on = Switch::parse(Some("endue.terminal"));
    let drawn = drawn(&plan, &on).expect("the terminal's window is left out");
    assert_eq!(ids(&drawn), vec!["endue.notes".to_owned()]);
    // The surfaces and the budget still read the whole plan: the terminal keeps its seat.
    assert!(plan.seat("endue.terminal").size.is_some());
    assert_eq!(drawn.shown, plan.shown);
}

#[test]
fn with_the_switch_off_or_naming_no_window_the_plan_is_drawn_as_it_is() {
    let plan = desk().host_plan(1440.0, 900.0, TopChrome::default(), &Unseen);
    assert_eq!(drawn(&plan, &Switch::parse(None)), None);
    assert_eq!(drawn(&plan, &Switch::parse(Some("endue.mail"))), None);
}

#[test]
fn an_app_window_is_found_by_its_os_window_and_closes_in_three_steps() {
    let mut apps: Registry<u32, &str> = Registry::default();
    assert!(apps.is_empty());
    assert_eq!(
        apps.insert("main.endue-terminal", 7, Some(41), "terminal"),
        None
    );
    assert_eq!(apps.surface_of(7), Some("main.endue-terminal"));
    assert_eq!(apps.get("main.endue-terminal"), Some(&"terminal"));
    assert_eq!(apps.surface_of(8), None);
    assert_eq!(apps.len(), 1);

    // The runtime closed it: the browser is asked, and the OS window no longer hears events.
    assert_eq!(apps.ask_close("main.endue-terminal"), Some(41));
    assert_eq!(apps.surface_of(7), None);
    assert_eq!(apps.get("main.endue-terminal"), None);
    assert_eq!(apps.going(41), Some(&"terminal"));
    assert!(!apps.is_empty(), "on its way out until its browser is gone");

    // `DoClose`: the window lets go; `OnBeforeClose`: nothing is left.
    assert_eq!(apps.agreed(41), Some("terminal"));
    assert_eq!(apps.going(41), None);
    assert!(!apps.is_empty(), "closing until OnBeforeClose");
    assert_eq!(apps.closed(41), None);
    assert!(apps.is_empty());
}

#[test]
fn opened_again_under_the_same_host_the_old_window_goes_and_the_new_one_stays() {
    let mut apps: Registry<u32, &str> = Registry::default();
    apps.insert("main.endue-terminal", 7, Some(41), "first");
    assert_eq!(
        apps.insert("main.endue-terminal", 9, Some(42), "second"),
        Some(41)
    );
    assert_eq!(apps.surface_of(7), None);
    assert_eq!(apps.surface_of(9), Some("main.endue-terminal"));
    assert_eq!(apps.going(41), Some(&"first"));
    // The old browser closing touches the new window not at all.
    assert_eq!(apps.agreed(41), Some("first"));
    assert_eq!(apps.closed(41), None);
    assert_eq!(apps.get("main.endue-terminal"), Some(&"second"));
    assert_eq!(apps.surfaces(), vec!["main.endue-terminal".to_owned()]);
}

#[test]
fn a_browser_that_closes_by_itself_takes_its_window_with_it() {
    let mut apps: Registry<u32, &str> = Registry::default();
    apps.insert("main.endue-terminal", 7, Some(41), "terminal");
    // `OnBeforeClose` with no `DoClose` before it (CEF destroyed the browser).
    assert_eq!(apps.closed(41), Some("terminal"));
    assert_eq!(apps.surface_of(7), None);
    assert!(apps.is_empty());
    // A window that never had a browser goes at once.
    apps.insert("main.endue-notes", 8, None, "notes");
    assert_eq!(apps.ask_close("main.endue-notes"), None);
    assert!(apps.is_empty());
}
