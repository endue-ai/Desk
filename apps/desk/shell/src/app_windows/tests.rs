use super::{App, Registry, Switch, plugin_of};

/// What the switch says of `plugin`'s surface `view`, `app` its manifest.
fn wants(switch: &Switch, plugin: &str, view: Option<&str>, app: Option<App>) -> bool {
    switch.wants(plugin, view, || app)
}

fn app(ui: bool, surfaces: &[(&str, bool)]) -> App {
    App {
        ui,
        name: "Terminal".into(),
        surfaces: surfaces
            .iter()
            .map(|(id, placed)| ((*id).into(), *placed))
            .collect(),
    }
}

#[test]
fn the_switch_names_plugins_by_id_separated_by_commas() {
    let on = Switch::parse(Some(" endue.terminal , endue.notes,,"));
    assert!(on.is_on());
    let named = |id: &str| wants(&on, id, None, None);
    assert!(named("endue.terminal"));
    assert!(named("endue.notes"));
    assert!(!named("endue.mail"));
    assert!(!named("endue"), "a whole id, never a prefix");
    assert!(!named(""));
    assert_eq!(
        Switch::parse(Some("endue.terminal")),
        Switch::parse(Some("endue.terminal,"))
    );
}

#[test]
fn the_switch_unset_empty_or_off_is_off() {
    for value in [
        None,
        Some(""),
        Some(" "),
        Some(",, ,"),
        Some("off"),
        Some("OFF"),
        Some("0"),
    ] {
        let off = Switch::parse(value);
        assert!(!off.is_on(), "{value:?}");
        assert!(!wants(
            &off,
            "endue.terminal",
            None,
            Some(app(true, &[("main", true)]))
        ));
    }
}

#[test]
fn on_every_ui_plugin_placed_center_or_floating_opens_in_a_window_of_its_own() {
    for value in ["on", "On", "apps", "1", "true"] {
        assert_eq!(Switch::parse(Some(value)), Switch::Apps, "{value}");
    }
    let on = Switch::Apps;
    let terminal = app(true, &[("main", true)]);
    assert!(wants(&on, "endue.terminal", None, Some(terminal.clone())));
    assert!(wants(
        &on,
        "endue.terminal",
        Some("main"),
        Some(terminal.clone())
    ));
    assert!(!wants(&on, "endue.terminal", Some("other"), Some(terminal)));
    // A surface placed at an edge or over the desk, a plugin that is not `ui`, one not installed.
    assert!(!wants(
        &on,
        "endue.dock",
        None,
        Some(app(true, &[("main", false)]))
    ));
    assert!(!wants(
        &on,
        "endue.logic",
        None,
        Some(app(false, &[("main", true)]))
    ));
    assert!(!wants(&on, "endue.gone", None, None));
    // A plugin with a center surface and an overlay: only the center one.
    let two = app(true, &[("main", true), ("prompt", false)]);
    assert!(wants(&on, "p.two", Some("main"), Some(two.clone())));
    assert!(!wants(&on, "p.two", Some("prompt"), Some(two)));
}

#[test]
fn an_app_is_read_from_its_manifest() {
    let manifest = |kind: &str, placement: &str| {
        let text = format!(
            r#"{{"id":"p.one","name":"One","version":"0.1.0","kind":"{kind}","surfaces":[{{"id":"main","placement":"{placement}"}}]}}"#
        );
        App::of(&serde_json::from_str(&text).expect("a manifest"))
    };
    assert!(manifest("ui", "center").opens(None));
    assert!(manifest("ui", "floating").opens(Some("main")));
    for placement in ["left", "right", "bottom", "overlay"] {
        assert!(!manifest("ui", placement).opens(None), "{placement}");
    }
    assert!(!manifest("logic", "center").opens(None));
    assert_eq!(manifest("ui", "center").name, "One");
}

/// A plugin's window after its first is keyed `<plugin>@<n>` (ADR 0212): the switch reads the
/// plugin it belongs to.
#[test]
fn a_window_key_names_its_plugin() {
    assert_eq!(plugin_of("endue.images"), "endue.images");
    assert_eq!(plugin_of("endue.images@2"), "endue.images");
    assert_eq!(plugin_of("endue.images@12"), "endue.images");
    for own in [
        "endue.images@",
        "endue.images@0",
        "endue.images@02",
        "endue.images@x",
        "@2",
    ] {
        assert_eq!(plugin_of(own), own, "{own}");
    }
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

#[path = "places_tests.rs"]
mod places;
