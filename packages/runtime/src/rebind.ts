/**
 * Editing the person's layer of the keymap (`desk.keys.bindings`), the way a rebinding screen does:
 * one key per command when the person picks it, the key it replaces taken away with `"command": ""`,
 * and a reset that drops the person's entries so the plugins' keys show through again.
 */
import type { KeyBinding } from "@endue-ai/bridge";
import { canonical, type Platform } from "./input";
import { resolveKeymap } from "./keymap";
import type { PolicySet } from "./policy";

export interface KeyLayers {
  /** Every plugin's bindings, in layer order. */
  contributed: PolicySet["keys"];
  /** The person's layer. */
  personal: KeyBinding[];
  platform: Platform;
}

const owned = (personal: KeyBinding[]) => personal.map((key) => ({ ...key, owner: "person" }));

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

/** Whether the person's layer leaves `command` with the plugins' keys. */
export function isDefault(layers: KeyLayers, command: string): boolean {
  return keysOf(layers, command).join(" ") === keysOf(layers, command, false).join(" ");
}

/** Take `combos` away: drop the person's entries for them, and unbind those a plugin binds. */
function free(layers: KeyLayers, combos: string[]): KeyBinding[] {
  const plugin = new Set(
    resolveKeymap(layers.contributed, layers.platform).map((binding) => binding.combo),
  );
  const kept = layers.personal.filter(
    (key) => !combos.includes(canonical(key.key, layers.platform)),
  );
  return [
    ...kept,
    ...combos.filter((combo) => plugin.has(combo)).map((combo) => ({ key: combo, command: "" })),
  ];
}

/**
 * Bind `combo` to `command` as its only key. Returns the new layer and the command that had the key,
 * if another did: it loses that key.
 */
export function rebind(
  layers: KeyLayers,
  command: string,
  combo: string,
): { personal: KeyBinding[]; displaced?: string } {
  const key = canonical(combo, layers.platform);
  const had = commandAt(layers, key);
  const others = keysOf(layers, command).filter((other) => other !== key);
  const personal = [
    ...free(layers, [...others, key]).filter((entry) => entry.key !== key),
    { key, command },
  ];
  return had && had !== command ? { personal, displaced: had } : { personal };
}

/** Take every key away from `command`. */
export function unbind(layers: KeyLayers, command: string): KeyBinding[] {
  return free(layers, keysOf(layers, command));
}

/** Give `command` its plugins' keys back, taking them from whichever command the person gave them. */
export function reset(layers: KeyLayers, command: string): KeyBinding[] {
  const plugin = keysOf(layers, command, false);
  return layers.personal.filter(
    (key) => key.command !== command && !plugin.includes(canonical(key.key, layers.platform)),
  );
}
