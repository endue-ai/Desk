//! The shell keymap in Rust (#56): `packages/runtime/src/keymap.ts`, `input.ts` and
//! `sequences/{parse,conflicts,router}.ts` ported with their tests (ADR 0118), so the compositor
//! decides before delivery whether a key is the desk's. Each test names the TypeScript test it ports.

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

// keymap.test.ts "canonical and formatCombo"
#[test]
fn keys_are_named_the_same_way_on_every_platform_and_read_the_platforms_way() {
    assert_eq!(canonical("Mod+Shift+p", Platform::Mac), "Meta+Shift+P");
    assert_eq!(canonical("Mod+Shift+p", Platform::Other), "Control+Shift+P");
    assert_eq!(
        canonical("Ctrl+Alt+ArrowLeft", Platform::Mac),
        "Control+Alt+ArrowLeft"
    );
    assert_eq!(canonical("Mod++", Platform::Other), "Control++");
    assert_eq!(format_combo("Meta+Shift+P", Platform::Mac), "⇧⌘P");
    assert_eq!(
        format_combo("Control+Shift+P", Platform::Other),
        "Ctrl+Shift+P"
    );
    assert_eq!(format_combo("Control++", Platform::Other), "Ctrl++");
}

fn combos(bindings: &[Resolved]) -> Vec<String> {
    bindings.iter().map(|b| b.combo.clone()).collect()
}

/// A keymap with these keys, every command known.
fn keymap(platform: Platform, keys: &[(&str, &str)]) -> Keymap {
    let mut keymap = Keymap::new(platform);
    let entries: Vec<KeyEntry> = keys.iter().map(|(k, c)| entry(k, c, "desk")).collect();
    keymap.apply(&entries, None);
    keymap
}

fn ran(decision: KeyDecision) -> Option<String> {
    match decision {
        KeyDecision::Run { command, .. } => Some(command),
        _ => None,
    }
}

// keymap.test.ts "Keymap": the bound command runs; a command that is off passes on.
#[test]
fn a_bound_key_runs_and_one_whose_command_is_off_passes_on() {
    let mut keymap = Keymap::new(Platform::Mac);
    keymap.apply(
        &[entry("Mod+K", "desk.palette.open", "desk.keys")],
        Some(&[]),
    );
    assert_eq!(keymap.press(&key("k", "m"), None, 0), KeyDecision::PassOn);
    keymap.set_known(Some(&["desk.palette.open".to_owned()]));
    assert_eq!(
        ran(keymap.press(&key("k", "m"), None, 0)).as_deref(),
        Some("desk.palette.open")
    );
    assert_eq!(keymap.keys_for("desk.palette.open"), ["⌘K"]);
    keymap.apply(&[], None);
    assert_eq!(keymap.press(&key("k", "m"), None, 0), KeyDecision::PassOn);
}

#[test]
fn sequences_bind_conflicts_are_kept_and_a_prefix_lists_its_continuations() {
    let mut keymap = Keymap::new(Platform::Mac);
    keymap.apply(
        &[
            entry("Mod+K", "desk.palette.open", "desk"),
            entry("Mod+K Mod+S", "desk.files.save-all", "example.notes"),
        ],
        None,
    );
    assert_eq!(combos(keymap.bindings()), ["Meta+K Meta+S"]);
    let lost: Vec<(ConflictKind, &str)> = keymap
        .conflicts()
        .iter()
        .map(|c| (c.kind, c.binding.command.as_str()))
        .collect();
    assert_eq!(lost, [(ConflictKind::Shadowed, "desk.palette.open")]);
    let next: Vec<&str> = keymap
        .continuations(&["Meta+K"])
        .iter()
        .map(|b| b.command.as_str())
        .collect();
    assert_eq!(next, ["desk.files.save-all"]);
    assert_eq!(keymap.keys_for("desk.files.save-all"), ["⌘K ⌘S"]);
    assert_eq!(keymap.press(&key("k", "m"), None, 0), KeyDecision::Wait);
    assert_eq!(
        ran(keymap.press(&key("s", "m"), None, 0)).as_deref(),
        Some("desk.files.save-all")
    );
}

// router.test.ts
#[test]
fn a_prefix_waits_and_the_sequence_runs_when_it_is_complete() {
    let mut keymap = keymap(
        Platform::Mac,
        &[("Mod+K Mod+S", "save-all"), ("Mod+S", "save")],
    );
    assert_eq!(keymap.press(&key("k", "m"), None, 0), KeyDecision::Wait);
    assert_eq!(keymap.pending(), ["Meta+K"]);
    assert_eq!(
        ran(keymap.press(&key("s", "m"), None, 0)).as_deref(),
        Some("save-all")
    );
    assert!(keymap.pending().is_empty());
    let events = keymap.take_events();
    assert_eq!(
        events,
        [
            SequenceEvent::Pending {
                chords: vec!["Meta+K".into()],
                capturing: false
            },
            SequenceEvent::Done {
                chords: vec!["Meta+K".into(), "Meta+S".into()],
                outcome: Outcome::Ran
            },
        ]
    );
    // With nothing pending the same chord is its own key again.
    assert_eq!(
        ran(keymap.press(&key("s", "m"), None, 0)).as_deref(),
        Some("save")
    );
}

#[test]
fn escape_and_ctrl_g_cancel_a_prefix_and_an_unbound_continuation_is_said() {
    let mut keymap = keymap(
        Platform::Other,
        &[("Ctrl+X Ctrl+F", "find-file"), ("Escape", "quit")],
    );
    keymap.press(&key("x", "c"), None, 0);
    assert_eq!(
        keymap.press(&key("Escape", ""), None, 0),
        KeyDecision::Cancelled
    );
    keymap.press(&key("x", "c"), None, 0);
    assert_eq!(
        keymap.press(&key("g", "c"), None, 0),
        KeyDecision::Cancelled
    );
    keymap.press(&key("x", "c"), None, 0);
    assert_eq!(keymap.press(&key("q", "c"), None, 0), KeyDecision::Unbound);
    let outcomes: Vec<Outcome> = keymap
        .take_events()
        .into_iter()
        .filter_map(|e| match e {
            SequenceEvent::Done { outcome, .. } => Some(outcome),
            SequenceEvent::Pending { .. } => None,
        })
        .collect();
    assert_eq!(
        outcomes,
        [Outcome::Cancelled, Outcome::Cancelled, Outcome::Unbound]
    );
    assert_eq!(
        ran(keymap.press(&key("Escape", ""), None, 0)).as_deref(),
        Some("quit")
    );
}

#[test]
fn a_prefix_waits_without_a_limit_unless_the_timeout_is_set() {
    let mut keymap = keymap(Platform::Mac, &[("Mod+K Mod+S", "save-all")]);
    keymap.press(&key("k", "m"), None, 0);
    keymap.tick(10_000);
    assert_eq!(keymap.pending(), ["Meta+K"]);
    assert_eq!(
        ran(keymap.press(&key("s", "m"), None, 10_000)).as_deref(),
        Some("save-all")
    );
    keymap.set_timeout(1500);
    keymap.press(&key("k", "m"), None, 20_000);
    keymap.tick(21_000);
    assert_eq!(keymap.pending(), ["Meta+K"]);
    keymap.tick(21_600);
    assert!(keymap.pending().is_empty());
    assert_eq!(
        keymap.take_events().last(),
        Some(&SequenceEvent::Done {
            chords: vec!["Meta+K".into()],
            outcome: Outcome::Timeout
        })
    );
}

#[test]
fn the_wait_restarts_at_each_chord_of_a_deep_sequence() {
    let mut keymap = keymap(
        Platform::Other,
        &[
            ("Ctrl+C p f", "project-file"),
            ("Ctrl+C p s", "project-search"),
            ("Mod+K Mod+T Shift+T Alt+1", "deep"),
        ],
    );
    keymap.set_timeout(1500);
    keymap.press(&key("c", "c"), None, 0);
    keymap.tick(1000);
    keymap.press(&key("p", ""), None, 1000);
    keymap.tick(2000);
    assert_eq!(keymap.pending(), ["Control+C", "P"]);
    assert_eq!(
        ran(keymap.press(&key("f", ""), None, 2000)).as_deref(),
        Some("project-file")
    );
    let mut last = KeyDecision::PassOn;
    for press in [key("k", "c"), key("t", "c"), key("T", "s"), key("1", "a")] {
        last = keymap.press(&press, None, 2000);
        assert_ne!(last, KeyDecision::PassOn);
    }
    assert_eq!(ran(last).as_deref(), Some("deep"));
}

#[test]
fn a_surfaces_own_keymap_comes_first_and_a_held_repeating_chord_is_ignored_while_waiting() {
    let mut keymap = keymap(
        Platform::Mac,
        &[("Mod+K Mod+S", "desk.save-all"), ("Mod+S", "desk.save")],
    );
    keymap.bind_surface("notes", "Mod+S", "notes.save");
    assert_eq!(
        ran(keymap.press(&key("s", "m"), Some("notes"), 0)).as_deref(),
        Some("notes.save")
    );
    assert_eq!(
        ran(keymap.press(&key("s", "m"), Some("other"), 0)).as_deref(),
        Some("desk.save")
    );
    // The scope is fixed when the prefix starts.
    assert_eq!(
        keymap.press(&key("k", "m"), Some("notes"), 0),
        KeyDecision::Wait
    );
    let mut held = key("k", "m");
    held.repeat = true;
    assert_eq!(keymap.press(&held, Some("notes"), 0), KeyDecision::Ignored);
    assert_eq!(
        ran(keymap.press(&key("s", "m"), None, 0)).as_deref(),
        Some("desk.save-all")
    );
}

#[test]
fn a_capture_takes_a_whole_sequence_and_escape_ends_it() {
    let mut keymap = keymap(Platform::Mac, &[("Mod+K Mod+S", "save-all")]);
    keymap.capture_next();
    assert_eq!(keymap.press(&key("k", "m"), None, 0), KeyDecision::Wait);
    assert_eq!(
        keymap.press(&key("s", "m"), None, 0),
        KeyDecision::Captured("Meta+K Meta+S".into())
    );
    keymap.capture_next();
    keymap.press(&key("k", "m"), None, 0);
    assert_eq!(
        keymap.press(&key("Escape", ""), None, 0),
        KeyDecision::Captured("Escape".into())
    );
}

#[test]
fn modifier_keys_alone_are_no_chord() {
    let mut keymap = keymap(Platform::Mac, &[("Mod+K", "palette")]);
    assert_eq!(
        keymap.press(&key("Meta", "m"), None, 0),
        KeyDecision::PassOn
    );
    assert_eq!(
        keymap.press(&key("Shift", "s"), None, 0),
        KeyDecision::PassOn
    );
}
