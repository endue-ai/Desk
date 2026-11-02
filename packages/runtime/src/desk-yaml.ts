/**
 * The person's files in the desk folder are YAML (ADR 0079). Reading one parses it as YAML 1.2 (only
 * `true` and `false` are booleans), runs its check and, when either fails, says which line is wrong,
 * as init.yaml's problems do. Writing one puts a comment on top and every value on a line of its own,
 * so `git diff` shows what changed.
 */
import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  LineCounter,
  type Node,
  parseDocument,
  stringify,
} from "yaml";
import { type Check, isRecord, type Problem } from "./desk-checks";

export { type Check, checkKeysFile, checkProfileFile, type Problem } from "./desk-checks";

export type YamlRead<T> = { ok: true; value: T } | { ok: false; problem: string };

/**
 * Parse the file `name` (keys.yaml, profiles/focus.yaml) and check it. An empty file, or one with
 * only comments, is the empty mapping. A problem reads `line N: what is wrong`.
 */
export function readDeskYaml<T>(name: string, text: string, check: Check<T>): YamlRead<T> {
  const lines = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lines, prettyErrors: false });
  const [error] = doc.errors;
  if (error)
    return {
      ok: false,
      problem: `line ${lines.linePos(error.pos[0]).line}: ${firstLine(error.message)}`,
    };
  const value: unknown = doc.toJS() ?? {};
  if (!isRecord(value))
    return {
      ok: false,
      problem: `line ${lineOf(doc, [], lines)}: ${name} holds a mapping (key: value lines)`,
    };
  const [problem] = check(value);
  if (problem)
    return { ok: false, problem: `line ${lineOf(doc, problem.path, lines)}: ${problem.message}` };
  return { ok: true, value: value as T };
}

/** The text of a desk file: `header` as comment lines, then `value` in block style. */
export function deskYaml(value: unknown, header: string): string {
  const comment = header
    .split("\n")
    .map((line) => (line ? `# ${line}` : "#"))
    .join("\n");
  return `${comment}\n${stringify(value, { lineWidth: 0 })}`;
}

/** The line where `path` leads in the document: a mapping's key, a list's item, or the top. */
function lineOf(doc: Document, path: Problem["path"], lines: LineCounter): number {
  let node: unknown = doc.contents;
  let offset = (node as Node | null)?.range?.[0] ?? 0;
  for (const segment of path) {
    if (isMap(node)) {
      const pair = node.items.find(
        (item) => (isScalar(item.key) ? item.key.value : item.key) === segment,
      );
      if (!pair) break;
      offset = (pair.key as Node | null)?.range?.[0] ?? offset;
      node = pair.value;
    } else if (isSeq(node) && typeof segment === "number") {
      const item = node.items[segment] as Node | undefined;
      if (!item) break;
      offset = item.range?.[0] ?? offset;
      node = item;
    } else break;
  }
  return lines.linePos(offset).line;
}

const firstLine = (message: string) => message.split("\n")[0] ?? message;
