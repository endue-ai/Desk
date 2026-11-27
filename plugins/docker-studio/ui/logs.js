// Logs of a container or a stack: `docker logs` (or `docker compose logs`) with timestamps, read
// once or followed, split into lines with their stream, time, service and level; JSON lines read
// into their message and fields. Kept in a ring of at most `max` lines. No DOM.

import { stripAnsi } from "./errors.js";
import { objectRef, projectName } from "./refs.js";

/**
 * @typedef {"error" | "warn" | "info" | "debug" | ""} Level
 * @typedef {{ n: number, stream: "stdout" | "stderr", time: number, source: string, text: string,
 *   level: Level, message: string, fields: Array<[string, string]> }} Line
 * @typedef {{ kind: "container", id: string } | { kind: "project", name: string, files: string[] }} Target
 */

const TIME = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s?(.*)$/s;
const PREFIX = /^(\S+?)(?:-\d+)?\s+\| ?(.*)$/s;

/** The args that read a target's logs. @param {Target} target @param {{ tail: number, follow: boolean }} o */
export function logArgs(target, o) {
  const common = ["--timestamps", "--tail", String(o.tail), ...(o.follow ? ["--follow"] : [])];
  if (target.kind === "container") return ["logs", ...common, "--", objectRef(target.id)];
  return [
    "compose",
    "--ansi",
    "never",
    "--project-name",
    projectName(target.name),
    ...target.files.flatMap((f) => ["--file", f]),
    "logs",
    "--no-color",
    ...common,
  ];
}

/** The level a line says it is, from a JSON field or the words it starts with. @returns {Level} */
export function levelOf(/** @type {string} */ text, /** @type {string} */ declared = "") {
  const word = (declared || text.slice(0, 160)).toLowerCase();
  if (/\b(error|err|fatal|panic|critical|crit|exception|emerg)\b|^e\s/.test(word)) return "error";
  if (/\b(warn|warning)\b/.test(word)) return "warn";
  if (/\b(debug|trace|dbug)\b/.test(word)) return "debug";
  if (/\b(info|notice|log)\b/.test(word)) return "info";
  return "";
}

const MESSAGE_KEYS = ["msg", "message", "MESSAGE", "event"];
const LEVEL_KEYS = ["level", "lvl", "severity", "LEVEL"];
const SKIP = new Set([...MESSAGE_KEYS, ...LEVEL_KEYS, "time", "ts", "timestamp", "@timestamp"]);

/** A JSON line's message, level and other fields; undefined when the line is not a JSON object. */
export function jsonLine(/** @type {string} */ text) {
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = MESSAGE_KEYS.map((k) => value[k]).find((v) => typeof v === "string") ?? "";
  const level = String(LEVEL_KEYS.map((k) => value[k]).find((v) => v !== undefined) ?? "");
  /** @type {Array<[string, string]>} */
  const fields = Object.entries(value)
    .filter(([k]) => !SKIP.has(k))
    .map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]);
  return { message, level, fields };
}

/**
 * One raw line as a Line: a stack's lines start with "service-1  | ", every line with its time.
 * @param {string} raw @param {"stdout" | "stderr"} stream @param {boolean} prefixed @param {number} n
 * @returns {Line}
 */
export function parseLine(raw, stream, prefixed, n) {
  let rest = stripAnsi(raw);
  let source = "";
  if (prefixed) {
    const found = PREFIX.exec(rest);
    if (found) {
      source = found[1] ?? "";
      rest = found[2] ?? "";
    }
  }
  let time = 0;
  const stamped = TIME.exec(rest);
  if (stamped) {
    time = Date.parse(stamped[1] ?? "");
    rest = stamped[2] ?? "";
  }
  const json = jsonLine(rest.trim());
  const level = levelOf(json ? json.message : rest, json?.level ?? "");
  return {
    n,
    stream,
    time,
    source,
    text: rest,
    level: level || (stream === "stderr" && !json ? "" : level),
    message: json ? json.message : rest,
    fields: json ? json.fields : [],
  };
}

/** A ring of lines that drops the oldest past `max`; `first` counts what dropped off. */
export function createRing(max = 5000) {
  /** @type {Line[]} */
  let lines = [];
  let first = 0;
  let n = 0;
  return {
    get lines() {
      return lines;
    },
    get first() {
      return first;
    },
    /** @param {string} raw @param {"stdout" | "stderr"} stream @param {boolean} prefixed */
    push(raw, stream, prefixed) {
      const line = parseLine(raw, stream, prefixed, n++);
      lines.push(line);
      if (lines.length > max) {
        const drop = lines.length - max;
        lines = lines.slice(drop);
        first += drop;
      }
      return line;
    },
    clear() {
      first += lines.length;
      lines = [];
    },
  };
}

/** Lines that match the search and the levels on, by index in the ring. */
export function filterLines(
  /** @type {Line[]} */ lines,
  /** @type {string} */ search,
  /** @type {Set<Level>} */ levels,
) {
  const needle = search.trim().toLowerCase();
  return lines.filter(
    (l) =>
      (levels.size === 0 || levels.has(l.level)) &&
      (needle === "" || `${l.source} ${l.text}`.toLowerCase().includes(needle)),
  );
}

/** The services of a stack's lines, in the order they first wrote, for their colours. */
export function sourcesOf(/** @type {Line[]} */ lines) {
  return [...new Set(lines.map((l) => l.source).filter(Boolean))];
}
