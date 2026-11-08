/**
 * Editing the person's layer of the keymap (`desk.keys.bindings`), the way a rebinding screen does:
 * one key per command when the person picks it, the key it replaces taken away with `"command": ""`,
 * and a reset that drops the person's entries so the plugins' keys show through again. A key is a
 * sequence of chords (ADR 0118): `checkRebind` says first what a new key would replace or shadow, so
 * the screen asks, and refuses a key that can never run.
 */
import type { KeyBinding } from "@endue-ai/bridge";
import { canonical, type Platform } from "./input";
import { resolveKeymap } from "./keymap";
import type { PolicySet } from "./policy";
import { type Resolved, resolveBindings } from "./sequences/conflicts";
import { chordsOf, isPrefix } from "./sequences/parse";
import { type Reserved, reservedChords, reservedIn } from "./sequences/reserved";

export interface KeyLayers {
  /** Core defaults and plugin bindings, in layer order. */
  contributed: PolicySet["keys"];
  /** The person's layer. */
  personal: KeyBinding[];
  platform: Platform;
}

const owned = (personal: KeyBinding[]) => personal.map((key) => ({ ...key, owner: "person" }));
const comboFor = (key: KeyBinding, platform: Platform) =>
  canonical(platform === "mac" && key.mac ? key.mac : key.key, platform);
/** Whether two canonical sequences are the same or one is a prefix of the other. */
const related = (a: string, b: string) => {
  const [x, y] = [chordsOf(a), chordsOf(b)];
  return a === b || isPrefix(x, y) || isPrefix(y, x);
};

/** The canonical keys of `command`, with or without the person's layer. */
export function keysOf(layers: KeyLayers, command: string, withPerson = true): string[] {
  const keys = withPerson ? [...layers.contributed, ...owned(layers.personal)] : layers.contributed;
  return resolveKeymap(keys, layers.platform)
    .filter((binding) => binding.command === command)
    .map((binding) => binding.combo);
}

/** The command a canonical key runs now. */
export function commandAt(layers: KeyLayers, combo: string): string | undefined {
  return resolveKeymap([...layers.contributed, ...owned(layers.personal)], layers.platform).find(
    (binding) => binding.combo === combo,
  )?.command;
}

/** Whether canonical chords are a prefix of a key in force, so a recorder waits for the next. */
export function continuesKey(layers: KeyLayers, chords: string[]): boolean {
  return resolveKeymap([...layers.contributed, ...owned(layers.personal)], layers.platform).some(
    (binding) => isPrefix(chords, chordsOf(binding.combo)),
  );
}

/** Whether the person's layer leaves `command` with the plugins' keys. */
export function isDefault(layers: KeyLayers, command: string): boolean {
  return keysOf(layers, command).join(" ") === keysOf(layers, command, false).join(" ");
}

export interface RebindCheck {
  /** The new key, canonical: "Meta+K Meta+S". */
  sequence: string;
  /** Why the key can never run (a cancel key after a prefix): the screen refuses it. */
  refused?: Reserved;
  /** A chord of it the system keeps: it may never reach the desk. */
  reserved?: Reserved;
  /** The binding of another command on this very key: it loses the key. */
  replaces?: Resolved;
  /** Bindings of other commands one prefix away: a shorter key that would only wait for the next,
   * or a longer one that could not be reached. They lose their keys. */
  shadows: Resolved[];
}

/** What binding `combo` to `command` would do to the keymap, before it does it. */
export function checkRebind(layers: KeyLayers, command: string, combo: string): RebindCheck {
  const sequence = canonical(combo, layers.platform);
  const chords = chordsOf(sequence);
  const held = reservedIn(chords, reservedChords(layers.platform));
  const { bindings } = resolveBindings(
    [...layers.contributed, ...owned(layers.personal)],
    layers.platform,
  );
  const others = bindings.filter((binding) => binding.command !== command);
  const replaces = others.find((binding) => binding.combo === sequence);
  const shadows = others.filter(
    (binding) => isPrefix(binding.chords, chords) || isPrefix(chords, binding.chords),
  );
  return {
    sequence,
    ...(held?.never ? { refused: held } : held ? { reserved: held } : {}),
    ...(replaces ? { replaces } : {}),
    shadows,
  };
}

/** Take `combos` away: drop the person's entries for them, and unbind those a plugin binds. */
function free(layers: KeyLayers, combos: string[]): KeyBinding[] {
  const plugin = new Set(
    resolveKeymap(layers.contributed, layers.platform).map((binding) => binding.combo),
  );
  const kept = layers.personal.filter((key) => !combos.includes(comboFor(key, layers.platform)));
  return [
    ...kept,
    ...combos.filter((combo) => plugin.has(combo)).map((combo) => ({ key: combo, command: "" })),
  ];
}

/**
 * Bind `combo` to `command` as its only key. Returns the new layer, the command that had the key, if
 * another did (it loses that key), and the commands whose keys it shadows (they lose those).
 */
export function rebind(
  layers: KeyLayers,
  command: string,
  combo: string,
): { personal: KeyBinding[]; displaced?: string; shadowed?: string[] } {
  const check = checkRebind(layers, command, combo);
  const key = check.sequence;
  const others = keysOf(layers, command).filter((other) => other !== key);
  const shadowed = check.shadows.map((binding) => binding.combo);
  const personal = [
    ...free(layers, [...others, ...shadowed, key]).filter((entry) => entry.key !== key),
    { key, command },
  ];
  return {
    personal,
    ...(check.replaces ? { displaced: check.replaces.command } : {}),
    ...(check.shadows.length ? { shadowed: check.shadows.map((binding) => binding.command) } : {}),
  };
}

/** Take every key away from `command`. */
export function unbind(layers: KeyLayers, command: string): KeyBinding[] {
  return free(layers, keysOf(layers, command));
}

/** Give `command` its plugins' keys back, taking them from whichever command the person gave them
 * or gave a key one prefix away. */
export function reset(layers: KeyLayers, command: string): KeyBinding[] {
  const plugin = keysOf(layers, command, false);
  return layers.personal.filter(
    (key) =>
      key.command !== command &&
      !plugin.some((combo) => related(combo, comboFor(key, layers.platform))),
  );
}
