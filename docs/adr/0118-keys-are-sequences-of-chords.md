---
status: proposed
date: 2026-11-07
decision-makers: Team endue
---

# Keys are sequences of chords, and the keymap resolves every conflict out loud

## Context and Problem Statement

A binding was one chord (`KeyCombo`), and `resolveKeymap` kept one binding per chord, the last of
its layer order. The person asked for shortcuts that extend without limit, with Emacs-style prefixes
of any depth, and for them never to conflict. With one chord per binding the keymap runs out of
memorable chords, and a later plugin silently took a key from an earlier one. How is a key written,
how does the desk wait for the rest of it (also when the focus is in a plugin's frame), how long does
it wait, and what happens when two bindings want the same key or one is the prefix of another?

## Decision Drivers

* Every existing binding, plugin manifest and `keys.yaml` keeps working and means the same
* Any depth, anywhere a key is bound: core defaults, `contributes.keys`, `~/.desk/keys.yaml`, the
  rebinder
* No binding is ever dropped without a word, and the word names the file and line to fix
* Plain keys after a prefix (`Ctrl+C p f`) must work while a plugin frame has the focus, without
  changing the frame protocol (#544 owns it)
* Keyboard-only and slow typists are not punished; the person can always see that the desk waits

## Considered Options

* A key is a string of chords separated by one space; a pending-prefix router; conflicts resolved by
  precedence and reported
* A key is an array of chords (`["Mod+K", "Mod+S"]`)
* Keep one chord and add "chord modes" a command enters

## Decision Outcome

Chosen option: "a string of chords separated by one space", because a single chord is then the
same string it was, the files stay readable (`key: Ctrl+X Ctrl+F`), and the grammar is one regular
expression the schema and the runtime share.

* **Grammar.** `KeySequence` in `specs/plugin/v0/contributes.schema.json`: one chord, or chords
  separated by exactly one space, at most 256 characters. `KeyBinding.key` and `mac` use it, and
  `keys.yaml` through `KeyBinding`. `KeyCombo` stays one chord (view actions use it). A chord after
  a prefix may be plain. `Space` names the space bar, so a space only ever separates chords.
* **Router.** `packages/runtime/src/sequences/router.ts` keeps a trie per scope (the global keymap,
  each surface's). A chord that is a prefix waits; the next one continues it; Escape and `Ctrl+G`
  cancel (so they never continue a prefix); an unbound continuation is consumed and said ("⌃X ⌃Q is
  not bound"). The scope is fixed when the prefix starts. A key still held and repeating is ignored
  while waiting. `captureNext` (desk.describe) captures a whole sequence.
* **Timeout.** `desk.keys.sequence-timeout`, default `0`: no limit, as in Emacs and as VS Code's
  chords. The overlay and the status area always show that the desk waits, a click or focus
  elsewhere cancels, and a time limit would fail people who type slowly (WCAG 2.2.1). People who want
  one choose 1, 1.5 or 3 seconds in Settings › Keyboard.
* **Frames.** A frame forwards only chords with Meta, Control or Alt, and Escape (the SDK). When a
  prefix starts, the which-key overlay takes the focus in the desk's own document, so the plain keys
  that follow reach the desk; when the wait ends the focus goes back to the element it came from
  (the frame), before the command runs and moves it. A plain key typed in the few milliseconds
  before the overlay has the focus still goes to the frame.
* **Which-key.** While a prefix is pending an overlay lists every continuation: the keys left, the
  command's title (marked when it cannot run now) and its owner. With its search empty, every key is
  first tried as the next chord; otherwise arrows select, Enter runs the selection, Backspace goes
  back one chord and a printable character starts a search. While searching, keys edit the search
  and only chords with a modifier continue. The status area shows "⌘K –" meanwhile. Both exist
  only while they say something, so render trees of an idle desk are unchanged.
* **Conflicts.** `sequences/conflicts.ts` resolves every layer's bindings by precedence: personal >
  plugin > core default, then the later binding within a layer. It reports a duplicate (the same
  sequence), prefix shadowing in both directions (the loser either only waits now or cannot be
  reached) and reserved chords: chords macOS or Windows and Linux take (`⌘Q`, `⌘Tab`, `Alt+F4` …) and
  the desk's global `Mod+Shift+Space` stay bound, for whoever turned the system shortcut off, and are
  reported; a cancel key after a prefix is never bound. A conflict within one layer is a warning; one
  that precedence settled across layers is info; one that can never run is an error. `"command":
  ""` taking a key away is intended and not reported. Every binding with a command ends up in force,
  in a conflict or taken away.
* **Sources.** Each binding names where it is written: `~/.desk/keys.yaml:<line>` (desk.keys reads
  the file and shares its lines), a manifest's `contributes.keys[<n>]` in the plugin's folder, init.yaml
  or a profile, or "core default". Settings › Keyboard lists every conflict with it, and
  `desk.keys.conflicts` answers the same conflicts and lint lines (`<where>: <severity>: <sentence>`)
  for `desk settings lint` (#290) to print.
* **Rebinder.** Recording reads a key as Emacs's `read-key-sequence` does: a chord that is a prefix
  of keys in force waits for the next, any other ends the key, so one chord commits at once as it
  always did. "Record several keys in a row" takes chords until Enter, for a new prefix. Backspace
  takes one back and Escape cancels, so a sequence using bare Enter, Backspace or Escape is written
  by hand. Before binding, `checkRebind`
  refuses a key that can never run and asks, listing them, when the key would replace or shadow
  others; once confirmed, the shadowed keys are taken away in the person's layer, so no conflict is
  left behind. Reset gives a command its keys back from whoever had them or a key one prefix away.
* **Describe.** `desk.describe` says a key sequence, a prefix and what continues it, what shadows a
  key and what it shadows, and a command's keys in force with their sequences.

### Consequences

* Good, because every existing key, manifest and `keys.yaml` reads the same, and a sequence is one
  more space in the same field.
* Good, because a binding a later layer or plugin beats is listed with the line that beats it, in the
  desk and for the CLI.
* Good, because plain keys after a prefix work in plugin frames without a protocol change.
* Bad, because a prefix makes its first chord wait: binding `Mod+K Mod+S` takes `Mod+K` from the
  palette until the person resets it (the rebinder says so first).
* Bad, because the reserved list is ours to keep up to date with the operating systems.
* Neutral: Shift with a digit is now named by the digit (`Mod+Shift+1`), from the physical key or the
  US layout, as Shift with punctuation already was.

## More Information

Issue #543. Code: `packages/runtime/src/sequences/` (`parse`, `chord`, `router`, `conflicts`,
`reserved`, `report`, `sources`, `which-key`, `indicator`, `record`, `keyboard-parts`),
`keymap.ts`, `input.ts`, `rebind.ts`, `settings-ui/keyboard.ts`, `policies/keys.ts`,
`policies/keys-file.ts`, `describe/describe.ts`, `plugins/palette/ui/keys.js`. Contract:
`specs/runtime/v0/settings.md`. Amends ADR 0055 (conflicts in the editor) and ADR 0079 (keys.yaml
holds sequences); `desk settings lint` is #290. No section of `docs/ko/desk-structure.md` changes.
