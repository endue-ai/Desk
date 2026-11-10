//! The shell keymap's grammar and precedence in Rust (#56): `sequences/parse.test.ts`,
//! `sequences/conflicts.test.ts` and `keymap.test.ts`'s `resolveKeymap` ported (ADR 0118).

use desk_compositor::input::keymap::*;

fn key(k: &str, mods: &str) -> KeyLike {
    KeyLike {
        key: k.to_owned(),
        code: None,
        meta: mods.contains('m'),
        ctrl: mods.contains('c'),
        alt: mods.contains('a'),
        shift: mods.contains('s'),
        repeat: false,
    }
}

fn entry(k: &str, command: &str, owner: &str) -> KeyEntry {
    KeyEntry {
        key: k.to_owned(),
        mac: None,
        command: command.to_owned(),
        args: None,
        owner: owner.to_owned(),
        source: None,
    }
}

// parse.test.ts: round trips, plain keys after a prefix, refusals, prefixes
#[test]
fn a_sequence_round_trips_and_plain_keys_follow_a_prefix() {
    for written in [
        "Mod+K Mod+S",
        "Ctrl+X Ctrl+F",
        "Ctrl+C p f",
        "Mod+K Mod+T Shift+T",
    ] {
        let chords: Vec<String> = written.split(' ').map(str::to_owned).collect();
        assert_eq!(parse_sequence(written), Ok(chords.clone()));
        for platform in [Platform::Mac, Platform::Other] {
            let once = canonical(written, platform);
            assert_eq!(canonical(&once, platform), once);
            assert!(parse_sequence(&once).is_ok());
            assert_eq!(format_chords(&once, platform).len(), chords.len());
        }
    }
    assert_eq!(canonical("Mod+K Mod+s", Platform::Mac), "Meta+K Meta+S");
    assert_eq!(format_combo("Meta+K Meta+S", Platform::Mac), "⌘K ⌘S");
    assert_eq!(
        format_chords("Control+X Control+F", Platform::Mac),
        ["⌃X", "⌃F"]
    );
    assert_eq!(canonical("Ctrl+C p f", Platform::Other), "Control+C P F");
    assert_eq!(format_combo("Control+C P F", Platform::Mac), "⌃C P F");
    assert_eq!(
        canonical("Ctrl+C Space +", Platform::Other),
        "Control+C Space +"
    );
    assert_eq!(chords_of("Control+C P F"), ["Control+C", "P", "F"]);
}

#[test]
fn an_empty_chord_a_dangling_modifier_other_white_space_and_a_long_key_are_refused() {
    let problem = |text: &str| parse_sequence(text).err().unwrap_or_default();
    assert!(problem("").contains("not empty"));
    assert!(problem("Mod+K  Mod+S").contains("chord 2 of"));
    assert!(problem("Ctrl+X ").contains("is empty"));
    assert!(problem(" Ctrl+X").contains("chord 1 of"));
    assert!(problem("Ctrl+X Ctrl+").contains("(Ctrl+) has no key"));
    assert!(problem("Ctrl+X\tCtrl+F").contains("one space, not a tab"));
    assert!(problem(&vec!["Mod+K"; 100].join(" ")).contains("at most 256"));
    assert!(is_prefix(&["Meta+K"], &["Meta+K", "Meta+S"]));
    assert!(!is_prefix(&["Meta+K"], &["Meta+K"]));
    assert!(!is_prefix(&["Meta+J"], &["Meta+K", "Meta+S"]));
}

#[test]
fn a_press_is_named_by_its_key_with_shift_digits_punctuation_and_alt_letters_by_the_key() {
    let mut press = key("!", "ms");
    press.code = Some("Digit1".into());
    assert_eq!(combo_of(&press), "Meta+Shift+1");
    assert_eq!(combo_of(&key("?", "ms")), "Meta+Shift+/");
    let mut option_d = key("∂", "ma");
    option_d.code = Some("KeyD".into());
    assert_eq!(combo_of(&option_d), "Meta+Alt+D");
    assert_eq!(combo_of(&key(" ", "c")), "Control+Space");
    assert_eq!(combo_of(&key("k", "mcas")), "Meta+Control+Alt+Shift+K");
    assert!(is_chorded("Meta+K") && !is_chorded("Shift+K") && !is_chorded("Escape"));
}

// keymap.test.ts "resolveKeymap"
#[test]
fn a_later_layer_rebinds_a_key_or_takes_it_away_and_macos_uses_mac_keys() {
    let mut jump = entry("Mod+J", "example.notes.jump", "example.notes");
    jump.mac = Some("Meta+Alt+J".into());
    let mut find = entry("Mod+K", "example.notes.find", "example.notes");
    find.args = Some(serde_json::json!({ "all": true }));
    let keys = vec![
        entry("Mod+W", "desk.buffers.close", "desk.keys"),
        entry("Mod+K", "desk.palette.open", "desk.keys"),
        jump,
        entry("Mod+W", "", "example.notes"),
        find,
    ];
    let other = resolve_keymap(&keys, Platform::Other);
    let other: Vec<(String, String, Option<serde_json::Value>)> = other
        .into_iter()
        .map(|b| (b.combo, b.command, b.args))
        .collect();
    assert_eq!(
        other,
        [
            ("Control+J".into(), "example.notes.jump".into(), None),
            (
                "Control+K".into(),
                "example.notes.find".into(),
                Some(serde_json::json!({ "all": true }))
            ),
        ]
    );
    let mac: Vec<String> = resolve_keymap(&keys, Platform::Mac)
        .into_iter()
        .map(|b| b.combo)
        .collect();
    assert_eq!(mac, ["Meta+Alt+J", "Meta+K"]);
}

// conflicts.test.ts
#[test]
fn the_same_sequence_twice_keeps_the_later_one_and_reports_the_other() {
    let entries = vec![
        entry("Mod+K Mod+S", "example.notes.save-all", "example.notes"),
        entry("Mod+K Mod+S", "example.todo.sort", "example.todo"),
    ];
    let r = resolve_bindings(&entries, Platform::Mac);
    assert_eq!(combos(&r.bindings), ["Meta+K Meta+S"]);
    assert_eq!(r.bindings[0].command, "example.todo.sort");
    assert_eq!(r.conflicts.len(), 1);
    let c = &r.conflicts[0];
    assert_eq!(
        (c.kind, c.severity, c.bound),
        (ConflictKind::Duplicate, Severity::Warning, false)
    );
    assert_eq!(c.binding.command, "example.notes.save-all");
    assert_eq!(
        c.by.as_ref().map(|b| b.owner.as_str()),
        Some("example.todo")
    );
}

#[test]
fn a_prefix_and_its_sequence_shadow_each_other_by_precedence() {
    // The person's Mod+K: a plugin's Mod+K Mod+S can never be reached.
    let r = resolve_bindings(
        &[
            entry("Mod+K Mod+S", "example.notes.save-all", "example.notes"),
            entry("Mod+K", "desk.palette.open", "person"),
        ],
        Platform::Other,
    );
    assert_eq!(combos(&r.bindings), ["Control+K"]);
    assert_eq!(r.conflicts[0].kind, ConflictKind::Shadowed);
    assert_eq!(r.conflicts[0].severity, Severity::Info);
    assert_eq!(r.conflicts[0].binding.combo, "Control+K Control+S");
    // A plugin's sequence over the core default: the default only waits now.
    let r = resolve_bindings(
        &[
            entry("Mod+K", "desk.palette.open", "desk"),
            entry("Mod+K Mod+S", "example.notes.save-all", "example.notes"),
        ],
        Platform::Mac,
    );
    assert_eq!(combos(&r.bindings), ["Meta+K Meta+S"]);
    assert_eq!(r.conflicts[0].binding.layer, KeyLayer::Default);
    assert_eq!(
        r.conflicts[0].by.as_ref().map(|b| b.layer),
        Some(KeyLayer::Plugin)
    );
    // Within one layer it is a warning.
    let same = resolve_bindings(
        &[
            entry("Ctrl+X", "example.a.cut", "example.a"),
            entry("Ctrl+X Ctrl+F", "example.b.find", "example.b"),
        ],
        Platform::Other,
    );
    assert_eq!(same.conflicts[0].severity, Severity::Warning);
    assert_eq!(same.conflicts[0].binding.command, "example.a.cut");
}

#[test]
fn reserved_chords_are_reported_and_a_cancel_key_after_a_prefix_is_never_bound() {
    let entries = vec![
        entry("Mod+Q", "example.notes.quit", "example.notes"),
        entry("Mod+Shift+Space", "example.notes.find", "person"),
        entry("Ctrl+X Escape", "example.notes.close", "person"),
        entry("Ctrl+X Ctrl+G", "example.notes.go", "person"),
        entry("Mod+Tab", "example.notes.next", "person"),
    ];
    let mac = resolve_bindings(&entries, Platform::Mac);
    let seen: Vec<(String, Severity, bool, String)> = mac
        .conflicts
        .iter()
        .map(|c| {
            let by = c
                .reserved
                .as_ref()
                .map(|r| r.by.clone())
                .unwrap_or_default();
            (c.binding.combo.clone(), c.severity, c.bound, by)
        })
        .collect();
    assert_eq!(
        seen,
        [
            (
                "Control+X Control+G".into(),
                Severity::Error,
                false,
                "the desk".into()
            ),
            (
                "Control+X Escape".into(),
                Severity::Error,
                false,
                "the desk".into()
            ),
            ("Meta+Q".into(), Severity::Warning, true, "macOS".into()),
            (
                "Meta+Shift+Space".into(),
                Severity::Warning,
                true,
                "the desk".into()
            ),
            ("Meta+Tab".into(), Severity::Warning, true, "macOS".into()),
        ]
    );
    assert_eq!(
        combos(&mac.bindings),
        ["Meta+Q", "Meta+Shift+Space", "Meta+Tab"]
    );
    let other = resolve_bindings(&entries, Platform::Other);
    let seen: Vec<(String, Severity)> = other
        .conflicts
        .iter()
        .map(|c| (c.binding.combo.clone(), c.severity))
        .collect();
    assert_eq!(
        seen,
        [
            ("Control+Shift+Space".into(), Severity::Warning),
            ("Control+X Control+G".into(), Severity::Error),
            ("Control+X Escape".into(), Severity::Error),
        ]
    );
}

#[test]
fn precedence_is_personal_then_plugin_then_default_whatever_order_they_come_in() {
    let r = resolve_bindings(
        &[
            entry("Mod+J", "example.person.jump", "person"),
            entry("Mod+J", "example.notes.jump", "example.notes"),
            entry("Mod+J", "desk.buffers.jump", "desk"),
            entry("Mod+L", "example.notes.list", "example.notes"),
            entry("Mod+L", "desk.keys.list", "desk"),
        ],
        Platform::Other,
    );
    let bound: Vec<(&str, &str)> = r
        .bindings
        .iter()
        .map(|b| (b.combo.as_str(), b.command.as_str()))
        .collect();
    assert_eq!(
        bound,
        [
            ("Control+J", "example.person.jump"),
            ("Control+L", "example.notes.list")
        ]
    );
    let lost: Vec<(&str, &str, Severity)> = r
        .conflicts
        .iter()
        .map(|c| {
            let by = c.by.as_ref().map_or("", |b| b.command.as_str());
            (c.binding.command.as_str(), by, c.severity)
        })
        .collect();
    assert_eq!(
        lost,
        [
            ("example.notes.jump", "example.person.jump", Severity::Info),
            ("desk.buffers.jump", "example.person.jump", Severity::Info),
            ("desk.keys.list", "example.notes.list", Severity::Info),
        ]
    );
}

#[test]
fn nothing_is_dropped_silently() {
    let entries = vec![
        entry("Mod+K", "desk.palette.open", "desk"),
        entry("Mod+W", "desk.buffers.close", "desk"),
        entry("Mod+K Mod+S", "example.notes.save-all", "example.notes"),
        entry(
            "Mod+K Mod+S Mod+A",
            "example.notes.save-as",
            "example.notes",
        ),
        entry("Ctrl+C p f", "example.project.file", "example.project"),
        entry("Ctrl+C p", "example.project.menu", "example.project"),
        entry("Mod+W", "", "person"),
        entry("Mod+Q", "example.notes.quit", "person"),
        entry("Ctrl+C p f", "example.person.find", "person"),
    ];
    let r = resolve_bindings(&entries, Platform::Mac);
    let mut accounted: Vec<usize> = r.bindings.iter().map(|b| b.index).collect();
    accounted.extend(
        r.conflicts
            .iter()
            .filter(|c| !c.bound)
            .map(|c| c.binding.index),
    );
    accounted.extend(r.removed.iter().map(|b| b.index));
    accounted.sort_unstable();
    let with_command: Vec<usize> = (0..entries.len())
        .filter(|i| !entries[*i].command.is_empty())
        .collect();
    assert_eq!(accounted, with_command);
    let removed: Vec<&str> = r.removed.iter().map(|b| b.command.as_str()).collect();
    assert_eq!(removed, ["desk.buffers.close"]);
    let commands: Vec<&str> = r.bindings.iter().map(|b| b.command.as_str()).collect();
    assert_eq!(
        commands,
        [
            "example.person.find",
            "example.notes.save-as",
            "example.notes.quit"
        ]
    );
}

fn combos(bindings: &[Resolved]) -> Vec<String> {
    bindings.iter().map(|b| b.combo.clone()).collect()
}
