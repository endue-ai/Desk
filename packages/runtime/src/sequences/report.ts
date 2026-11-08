/**
 * Conflicts in words, worded once for Settings › Keyboard, desk.keys.conflicts and the lint lines
 * `desk settings lint` prints (ADR 0118): what loses, to what, and where each one is written.
 */
import type { Platform } from "./chord";
import type { Conflict, Resolved } from "./conflicts";
import { formatSequence } from "./parse";

/** Where a binding is written: "~/.desk/keys.yaml:4", "/desk/plugins/notes/plugin.json
 * contributes.keys[2]", "core default". */
export function sourceText(binding: Resolved): string {
  const source = binding.source;
  if (source?.file && source.line) return `${source.file}:${source.line}`;
  if (source?.file) return source.path ? `${source.file} ${source.path}` : source.file;
  if (source?.label) return source.label;
  if (binding.layer === "default") return "core default";
  return binding.layer === "plugin" ? `plugin ${binding.owner}` : "your desk.keys.bindings";
}

export interface Wording {
  platform: Platform;
  /** A command's title, when the caller knows it; its id otherwise. */
  name?: (command: string) => string;
}

/** One conflict as a sentence. */
export function conflictText(conflict: Conflict, words: Wording): string {
  const keys = (b: Resolved) => formatSequence(b.combo, words.platform);
  const what = (b: Resolved) => `${words.name?.(b.command) ?? b.command} (${sourceText(b)})`;
  const { binding, by, reserved } = conflict;
  const mine = `${keys(binding)} for ${what(binding)}`;
  if (conflict.kind === "reserved" && reserved) {
    const chord = formatSequence(reserved.chord, words.platform);
    return reserved.never
      ? `${mine} can never run: ${chord} ${reserved.does}`
      : `${mine} uses ${chord}, which ${reserved.by} keeps (it ${reserved.does}): it runs only if that shortcut is off`;
  }
  if (!by) return mine;
  if (conflict.kind === "duplicate") return `${mine} is replaced by ${what(by)}`;
  return binding.chords.length > by.chords.length
    ? `${mine} cannot be reached: ${keys(by)} runs ${what(by)}`
    : `${mine} is a prefix of ${keys(by)}, which runs ${what(by)}: ${keys(binding)} only waits for the next key`;
}

/** Lint lines, one per conflict: "<where>: <severity>: <sentence>". */
export function lintLines(conflicts: Conflict[], words: Wording): string[] {
  return conflicts.map(
    (conflict) =>
      `${sourceText(conflict.binding)}: ${conflict.severity}: ${conflictText(conflict, words)}`,
  );
}
