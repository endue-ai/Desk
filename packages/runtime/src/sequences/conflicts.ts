/**
 * The conflict resolver (ADR 0118). Every binding of every layer goes in; out come the bindings in
 * force and every conflict, so no binding is ever dropped without a word. Precedence is personal >
 * plugin > core default, and within a layer the later binding wins. Two bindings conflict when they
 * have the same sequence (a duplicate) or one is a prefix of the other (shadowing: Mod+K bound to a
 * command while Mod+K Mod+S is bound too; a key cannot both run and wait). A reserved chord is
 * reported too (`reserved.ts`). `"command": ""` takes a sequence away from lower layers; that is
 * intended, not a conflict.
 */
import type { KeyBinding } from "@endue-ai/bridge";
import type { Platform } from "./chord";
import { canonicalSequence, chordsOf, isPrefix } from "./parse";
import { type Reserved, reservedChords, reservedIn } from "./reserved";

export type KeyLayer = "default" | "plugin" | "personal";

/** Where a binding is written, so people can find it. */
export interface KeySource {
  file?: string;
  /** The line in `file`, when the desk read the file itself (keys.yaml). */
  line?: number;
  /** Where in the file's data, when there is no line: contributes.keys[2]. */
  path?: string;
  /** The layer in words, when there is no file: core default, init.yaml, profile focus. */
  label?: string;
}

/** A binding as a layer has it, with the plugin (or "desk", or "person") it comes from. */
export type KeyEntry = KeyBinding & { owner: string; source?: KeySource };

export interface Resolved {
  /** The canonical sequence: "Meta+K Meta+S". */
  combo: string;
  chords: string[];
  command: string;
  args?: unknown;
  owner: string;
  layer: KeyLayer;
  /** The entry's place among the ones resolved, in layer order. */
  index: number;
  source?: KeySource;
}

export type ConflictKind = "duplicate" | "shadowed" | "reserved";

export interface Conflict {
  kind: ConflictKind;
  /** error: it can never run; warning: a layer is at odds with itself, or the system has the
   * chord; info: a higher layer won, as precedence says. */
  severity: "error" | "warning" | "info";
  /** The binding that loses, or the one that holds a reserved chord. */
  binding: Resolved;
  /** The binding in force that beats it. */
  by?: Resolved;
  reserved?: Reserved;
  /** Whether `binding` is in force all the same (a reserved chord stays bound). */
  bound: boolean;
}

export interface Resolution {
  /** The bindings in force, in sequence order. */
  bindings: Resolved[];
  conflicts: Conflict[];
  /** Bindings a higher `"command": ""` took away. */
  removed: Resolved[];
}

const LEVEL: Record<KeyLayer, number> = { default: 0, plugin: 1, personal: 2 };

/** The layer of an owner: the person's, the desk's own defaults, or a plugin's. */
export function layerOf(owner: string): KeyLayer {
  if (owner === "person") return "personal";
  return owner === "desk" ? "default" : "plugin";
}

const rank = (a: Resolved) => LEVEL[a.layer] * 1e6 + a.index;

/** The bindings of every layer, resolved for a platform. */
export function resolveBindings(
  entries: KeyEntry[],
  platform: Platform,
  reserved: Reserved[] = reservedChords(platform),
): Resolution {
  const all = entries.map((entry, index): Resolved => {
    const combo = canonicalSequence(
      platform === "mac" && entry.mac ? entry.mac : entry.key,
      platform,
    );
    return {
      combo,
      chords: chordsOf(combo),
      command: entry.command,
      owner: entry.owner,
      layer: layerOf(entry.owner),
      index,
      ...("args" in entry ? { args: entry.args } : {}),
      ...(entry.source ? { source: entry.source } : {}),
    };
  });
  const taken = new Map<string, Resolved>();
  const unbound = new Set<string>();
  const conflicts: Conflict[] = [];
  const removed: Resolved[] = [];
  const severity = (loser: Resolved, winner: Resolved) =>
    loser.layer === winner.layer ? "warning" : "info";

  for (const binding of [...all].sort((a, b) => rank(b) - rank(a))) {
    const { combo, chords } = binding;
    if (binding.command === "") {
      if (!taken.has(combo)) unbound.add(combo);
      continue;
    }
    if (unbound.has(combo)) {
      removed.push(binding);
      continue;
    }
    const held = reservedIn(chords, reserved);
    if (held?.never) {
      conflicts.push({
        kind: "reserved",
        severity: "error",
        binding,
        reserved: held,
        bound: false,
      });
      continue;
    }
    const same = taken.get(combo);
    if (same) {
      conflicts.push({
        kind: "duplicate",
        severity: severity(binding, same),
        binding,
        by: same,
        bound: false,
      });
      continue;
    }
    const by = [...taken.values()].find(
      (other) => isPrefix(other.chords, chords) || isPrefix(chords, other.chords),
    );
    if (by) {
      conflicts.push({
        kind: "shadowed",
        severity: severity(binding, by),
        binding,
        by,
        bound: false,
      });
      continue;
    }
    taken.set(combo, binding);
    if (held)
      conflicts.push({
        kind: "reserved",
        severity: "warning",
        binding,
        reserved: held,
        bound: true,
      });
  }
  const order = (a: Resolved, b: Resolved) =>
    a.combo < b.combo ? -1 : a.combo > b.combo ? 1 : a.index - b.index;
  conflicts.sort((a, b) => order(a.binding, b.binding));
  return { bindings: [...taken.values()].sort(order), conflicts, removed: removed.sort(order) };
}

/** The bindings in force under a prefix (every continuation), in sequence order. */
export function continuations(bindings: Resolved[], prefix: string[]): Resolved[] {
  return bindings.filter((binding) => isPrefix(prefix, binding.chords));
}
