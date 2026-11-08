/**
 * Where each binding is written (ADR 0118), so a conflict names its source line: keys.yaml's line
 * for the person's (desk.keys reads the file, `keys-file.ts`), the manifest and its contributes.keys
 * index for a plugin's, "core default" for the desk's own.
 */
import type { KeyBinding, PluginInfo } from "@endue-ai/bridge";
import { isSeq, LineCounter, type Node, parseDocument } from "yaml";
import type { KeyEntry, KeySource } from "./conflicts";

/** The line of each item of keys.yaml's `bindings`, by index; empty when the text has none. */
export function bindingLines(text: string): number[] {
  const counter = new LineCounter();
  const doc = parseDocument(text, { lineCounter: counter, prettyErrors: false });
  if (doc.errors.length) return [];
  const bindings = doc.get("bindings", true);
  if (!isSeq(bindings)) return [];
  return bindings.items.map((item) => counter.linePos((item as Node).range?.[0] ?? 0).line);
}

/** The person's file as desk.keys last read or wrote it, when its bindings are the ones in force. */
export interface PersonalFile {
  file: string;
  lines: number[];
}

/** Shared by desk.keys and its file: they get the same settings, so that is the key. */
class PersonalSources {
  #file: PersonalFile | undefined;
  readonly #listeners = new Set<() => void>();

  get(): PersonalFile | undefined {
    return this.#file;
  }

  set(file: PersonalFile | undefined): void {
    if (JSON.stringify(file) === JSON.stringify(this.#file)) return;
    this.#file = file;
    for (const listener of [...this.#listeners]) listener();
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

const shared = new WeakMap<object, PersonalSources>();

export function personalSources(settings: object): PersonalSources {
  let sources = shared.get(settings);
  if (!sources) {
    sources = new PersonalSources();
    shared.set(settings, sources);
  }
  return sources;
}

export interface SourceFacts {
  plugins: readonly PluginInfo[];
  /** The settings layer the person's bindings come from: session (keys.yaml), profile or init. */
  layer: "session" | "profile" | "init" | undefined;
  file?: PersonalFile;
}

/** Every layer's bindings, in layer order, each with where it is written. */
export function withSources(
  defaults: Array<KeyBinding & { owner: string }>,
  plugins: Array<KeyBinding & { owner: string }>,
  personal: KeyBinding[],
  facts: SourceFacts,
): KeyEntry[] {
  const seen = new Map<string, number>();
  const folder = (owner: string) => facts.plugins.find((p) => p.id === owner)?.folder;
  const pluginSource = (owner: string): KeySource => {
    const n = seen.get(owner) ?? 0;
    seen.set(owner, n + 1);
    const at = folder(owner);
    return at
      ? { file: `${at}/plugin.json`, path: `contributes.keys[${n}]` }
      : { label: `plugin ${owner}`, path: `contributes.keys[${n}]` };
  };
  const personalSource = (i: number): KeySource => {
    const { layer, file } = facts;
    if (layer === "session" && file) {
      const line = file.lines[i];
      return line ? { file: file.file, line } : { file: file.file, path: `bindings[${i}]` };
    }
    const label =
      layer === "init" ? "init.yaml" : layer === "profile" ? "the profile" : "this session";
    return { label: `${label} desk.keys.bindings[${i}]` };
  };
  return [
    ...defaults.map((entry) => ({ ...entry, source: { label: "core default" } })),
    ...plugins.map((entry) => ({ ...entry, source: pluginSource(entry.owner) })),
    ...personal.map((entry, i) => ({ ...entry, owner: "person", source: personalSource(i) })),
  ];
}
