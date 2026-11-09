//! The floating Eris's rules (ADR 0121, #546): focus in, show or hide out, under auto, always and
//! never; what the shortcut does by which window is active; her spot per display; the shortcut in
//! force and how it reads. Ported from the Tauri shell; what the floating window may ask the core is
//! `desk_web::sender`'s now (`Sender::may_ask`).

use super::machine::{Effect, Event, Float, Machine, Win};
use super::place::{Display, Positions, Rect, display_key, inside, resize};
use super::shortcut::{self, chosen, label, taken};

/// A machine with the desk in front, then `events`, settled once as the window layer does.
fn after(mode: Float, events: &[Event]) -> (Machine, Vec<Effect>) {
    let mut machine = Machine::new(mode);
    machine.on(Event::Focus(Win::Main, true));
    let mut effects = Vec::new();
    for event in events {
        effects.extend(machine.on(*event));
    }
    effects.extend(machine.settle());
    (machine, effects)
}

const SHOW: Effect = Effect::Show { summon: false };
const SUMMON: Effect = Effect::Show { summon: true };

#[test]
fn auto_floats_while_another_app_is_in_front_and_hides_when_the_desk_is_back() {
    let (mut machine, effects) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    assert_eq!(effects, vec![SHOW]);
    assert!(machine.shown());
    machine.on(Event::Focus(Win::Main, true));
    assert_eq!(machine.settle(), vec![Effect::Hide]);
    assert!(!machine.shown());
}

#[test]
fn auto_floats_while_the_main_window_is_hidden_or_minimized() {
    for gone in [
        vec![Event::MainOnScreen(false)],
        vec![Event::Focus(Win::Main, false), Event::MainOnScreen(false)],
    ] {
        let (_, effects) = after(Float::Auto, &gone);
        assert_eq!(effects, vec![SHOW], "{gone:?}");
    }
    // Shown and focused again: inside the desk.
    let (mut machine, _) = after(Float::Auto, &[Event::MainOnScreen(false)]);
    machine.on(Event::MainOnScreen(true));
    machine.on(Event::Focus(Win::Main, true));
    assert_eq!(machine.settle(), vec![Effect::Hide]);
}

#[test]
fn nothing_floats_until_the_desk_has_been_in_front_once() {
    // A desk started in the background, or on a display with no window manager (the app e2e under
    // Xvfb), reports no focus: she stays away, under auto and always.
    for mode in [Float::Auto, Float::Always] {
        let mut machine = Machine::new(mode);
        machine.on(Event::Focus(Win::Main, false));
        machine.on(Event::MainOnScreen(true));
        assert!(machine.settle().is_empty(), "{mode:?}");
        assert!(machine.on(Event::Mode(mode)).is_empty(), "{mode:?}");
    }
    // In front once, then not: she floats.
    let mut machine = Machine::new(Float::Auto);
    machine.on(Event::Focus(Win::Main, true));
    assert!(machine.settle().is_empty());
    machine.on(Event::Focus(Win::Main, false));
    assert_eq!(machine.settle(), vec![SHOW]);
    // The person may still summon her before that.
    let mut machine = Machine::new(Float::Auto);
    machine.on(Event::Focus(Win::Main, false));
    assert_eq!(machine.on(Event::Shortcut), vec![SUMMON]);
}

#[test]
fn auto_stays_inside_while_the_desk_is_active() {
    let (_, effects) = after(Float::Auto, &[]);
    assert!(effects.is_empty());
    let (_, effects) = after(
        Float::Auto,
        &[
            Event::Focus(Win::Main, false),
            Event::Focus(Win::Main, true),
        ],
    );
    assert!(
        effects.is_empty(),
        "a blur and a focus in one burst: {effects:?}"
    );
}

#[test]
fn the_palette_passing_through_leaves_her_as_she_is() {
    // Search Desk over the active desk: no floating Eris flashes up.
    let (mut machine, effects) = after(
        Float::Auto,
        &[
            Event::Focus(Win::Main, false),
            Event::Focus(Win::Palette, true),
        ],
    );
    assert!(effects.is_empty());
    // Back to the desk from the palette.
    machine.on(Event::Focus(Win::Palette, false));
    machine.on(Event::Focus(Win::Main, true));
    assert!(machine.settle().is_empty());
    // Search Desk over another app while she floats: she stays.
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Focus(Win::Palette, true));
    assert!(machine.settle().is_empty());
    assert!(machine.shown());
}

#[test]
fn her_own_window_in_focus_keeps_her_floating() {
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Focus(Win::Eris, true));
    assert!(machine.settle().is_empty());
    assert!(machine.shown());
    machine.on(Event::Focus(Win::Eris, false));
    assert!(
        machine.settle().is_empty(),
        "another app in front: she still floats"
    );
}

#[test]
fn always_floats_over_the_active_desk_too() {
    let (_, effects) = after(Float::Always, &[]);
    assert_eq!(effects, vec![SHOW]);
    let (mut machine, _) = after(Float::Always, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Focus(Win::Main, true));
    assert!(machine.settle().is_empty());
    assert!(machine.shown());
}

#[test]
fn never_floats_and_hides_her_when_the_setting_turns_to_never() {
    let (_, effects) = after(
        Float::Never,
        &[Event::Focus(Win::Main, false), Event::MainOnScreen(false)],
    );
    assert!(effects.is_empty());
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    assert_eq!(machine.on(Event::Mode(Float::Never)), vec![Effect::Hide]);
    assert_eq!(machine.on(Event::Mode(Float::Auto)), vec![SHOW]);
}

#[test]
fn the_shortcut_opens_her_composer_inside_the_active_desk() {
    let (mut machine, _) = after(Float::Auto, &[]);
    assert_eq!(
        machine.on(Event::Shortcut),
        vec![Effect::TalkInDesk { toggle: true }]
    );
    // Always floats, but an active desk still answers inside.
    let (mut machine, _) = after(Float::Always, &[]);
    assert_eq!(
        machine.on(Event::Shortcut),
        vec![Effect::TalkInDesk { toggle: true }]
    );
}

#[test]
fn the_shortcut_summons_the_floating_eris_while_the_desk_is_inactive() {
    // She floats already: focused with her composer open.
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    assert_eq!(machine.on(Event::Shortcut), vec![SUMMON]);
    // The main window hidden and nothing floating yet (dismissed): she comes.
    let (mut machine, _) = after(Float::Auto, &[Event::MainOnScreen(false), Event::Dismiss]);
    assert!(!machine.shown());
    assert_eq!(machine.on(Event::Shortcut), vec![SUMMON]);
    assert!(machine.shown());
}

#[test]
fn the_shortcut_again_or_esc_dismisses_her_until_the_desk_is_next_in_front() {
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Shortcut);
    machine.on(Event::Focus(Win::Eris, true));
    assert_eq!(machine.on(Event::Shortcut), vec![Effect::Hide]);
    assert!(machine.settle().is_empty(), "dismissed: she stays away");
    // Esc does the same.
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Focus(Win::Eris, true));
    assert_eq!(machine.on(Event::Dismiss), vec![Effect::Hide]);
    machine.on(Event::Focus(Win::Eris, false));
    assert!(machine.settle().is_empty());
    // The desk in front and then not: she floats again.
    machine.on(Event::Focus(Win::Main, true));
    assert!(machine.settle().is_empty());
    machine.on(Event::Focus(Win::Main, false));
    assert_eq!(machine.settle(), vec![SHOW]);
}

#[test]
fn a_focus_the_desk_already_had_does_not_bring_a_dismissed_eris_back() {
    // Always floats over the active desk; Esc sends her away, and the desk staying focused (as
    // the window layer reads it again on every settle) leaves her away.
    let (mut machine, _) = after(Float::Always, &[]);
    assert_eq!(machine.on(Event::Dismiss), vec![Effect::Hide]);
    machine.on(Event::Focus(Win::Main, true));
    assert!(machine.settle().is_empty());
    // Away and back: she floats again.
    machine.on(Event::Focus(Win::Main, false));
    machine.on(Event::Focus(Win::Main, true));
    assert_eq!(machine.settle(), vec![SHOW]);
}

#[test]
fn the_shortcut_brings_the_desk_forward_when_floating_is_off() {
    let (mut machine, _) = after(Float::Never, &[Event::Focus(Win::Main, false)]);
    assert_eq!(
        machine.on(Event::Shortcut),
        vec![Effect::RevealMain, Effect::TalkInDesk { toggle: false }]
    );
}

#[test]
fn a_summoned_eris_out_of_focus_is_summoned_again_not_dismissed() {
    let (mut machine, _) = after(Float::Auto, &[Event::Focus(Win::Main, false)]);
    machine.on(Event::Shortcut);
    machine.on(Event::Focus(Win::Eris, true));
    machine.on(Event::Focus(Win::Eris, false));
    assert_eq!(machine.on(Event::Shortcut), vec![SUMMON]);
}

#[test]
fn the_setting_reads_auto_always_and_never() {
    assert_eq!(Float::parse(None), Float::Auto);
    assert_eq!(Float::parse(Some("auto")), Float::Auto);
    assert_eq!(Float::parse(Some("always")), Float::Always);
    assert_eq!(Float::parse(Some(" never ")), Float::Never);
    assert_eq!(Float::parse(Some("sometimes")), Float::Auto);
}

fn display(key: &str, x: i32, y: i32) -> Display {
    Display {
        key: key.to_owned(),
        area: Rect {
            x,
            y,
            width: 2000,
            height: 1200,
        },
    }
}

#[test]
fn her_spot_is_kept_per_display() {
    let laptop = display("Built-in 2000x1200", 0, 0);
    let monitor = display("DELL U2723QE 2000x1200", 2000, 0);
    let mut kept = Positions::default();
    // Never moved: the bottom-right corner, 48 px in.
    let first = kept.place(&laptop, (300, 400), 48);
    assert_eq!((first.x, first.y), (2000 - 48 - 300, 1200 - 48 - 400));
    // Dragged on each display.
    let on_laptop = Rect {
        x: 100,
        y: 200,
        width: 300,
        height: 400,
    };
    let on_monitor = Rect {
        x: 2600,
        y: 50,
        ..on_laptop
    };
    assert!(kept.remember(&laptop, on_laptop));
    assert!(kept.remember(&monitor, on_monitor));
    assert!(!kept.remember(&monitor, on_monitor), "the same spot again");
    assert_eq!(kept.place(&laptop, (300, 400), 48), on_laptop);
    assert_eq!(kept.place(&monitor, (300, 400), 48), on_monitor);
    // Kept across a restart.
    let again = Positions::parse(&kept.to_json());
    assert_eq!(again, kept);
    assert_eq!(again.place(&monitor, (300, 400), 48), on_monitor);
    // A monitor moved to the left keeps her spot on it.
    let moved = display("DELL U2723QE 2000x1200", -2000, 0);
    let spot = again.place(&moved, (300, 400), 48);
    assert_eq!((spot.x, spot.y), (600 - 2000, 50));
}

#[test]
fn a_kept_spot_off_the_display_is_brought_back_onto_it() {
    let small = Display {
        key: "Projector 800x600".to_owned(),
        area: Rect {
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        },
    };
    let mut kept = Positions::default();
    let far = Rect {
        x: 1700,
        y: 900,
        width: 300,
        height: 400,
    };
    kept.remember(&display("Projector 800x600", 0, 0), far);
    let placed = kept.place(&small, (300, 400), 48);
    assert_eq!((placed.x, placed.y), (500, 200));
    assert_eq!(Positions::parse("not json"), Positions::default());
}

#[test]
fn growing_for_the_composer_keeps_her_figure_in_place() {
    let area = Rect {
        x: 0,
        y: 0,
        width: 2000,
        height: 1200,
    };
    let figure = Rect {
        x: 900,
        y: 100,
        width: 200,
        height: 240,
    };
    let open = resize(figure, (400, 600), area);
    assert_eq!(
        (open.x, open.y, open.width, open.height),
        (800, 100, 400, 600)
    );
    // Near the bottom-right corner it grows onto the display instead.
    let corner = Rect {
        x: 1790,
        y: 950,
        ..figure
    };
    let open = resize(corner, (400, 600), area);
    assert_eq!((open.x, open.y), (1600, 600));
    let larger = inside(
        Rect {
            x: -50,
            y: -50,
            width: 3000,
            height: 100,
        },
        area,
    );
    assert_eq!((larger.x, larger.y), (0, 0));
}

#[test]
fn display_keys_name_the_screen() {
    assert_eq!(
        display_key(Some("Built-in Retina Display"), (0, 0), (3024, 1964)),
        "Built-in Retina Display 3024x1964"
    );
    assert_eq!(
        display_key(None, (-1920, 0), (1920, 1080)),
        "-1920,0 1920x1080"
    );
    assert_eq!(display_key(Some(" "), (0, 0), (800, 600)), "0,0 800x600");
}

#[test]
fn the_shortcut_is_the_environments_then_the_settings_then_alt_enter() {
    assert_eq!(chosen(None, None), shortcut::DEFAULT);
    assert_eq!(chosen(None, Some("Alt+Space")), "Alt+Space");
    assert_eq!(
        chosen(Some("Control+Shift+E"), Some("Alt+Space")),
        "Control+Shift+E"
    );
    assert_eq!(chosen(Some(" "), Some("")), "Alt+Enter");
}

#[test]
fn the_shortcut_reads_as_symbols_on_macos() {
    assert_eq!(label("Alt+Enter", true), "⌥↩");
    assert_eq!(label("CommandOrControl+Shift+KeyE", true), "⌘⇧E");
    assert_eq!(label("Alt+Enter", false), "Alt+Enter");
    assert_eq!(label("CmdOrCtrl+Shift+Digit1", false), "Ctrl+Shift+1");
    let (title, body) = taken("Alt+Enter", true, "already registered");
    assert_eq!(title, "⌥↩ cannot summon Eris");
    assert!(body.contains("Talk to Eris"), "{body}");
    assert!(body.contains("endue.eris.shortcut"), "{body}");
    assert!(body.contains("already registered"), "{body}");
}
