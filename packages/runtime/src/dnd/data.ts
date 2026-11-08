// Desk data as the runtime reads it from a frame (ADR 0119): a drag whose items, effects or image do
// not hold is refused whole. Paths are absolute bridge paths without `..`; a URI is not script; JSON
// carries a kind; everything is bounded. Then the text fallback, the offered types and the image.
import type { DeskData, DeskPath, DragImage, DragKeys, DropAnswer, DropEffect } from "./types";

export const EFFECTS: readonly DropEffect[] = ["copy", "move", "link"];
export const NO_KEYS: DragKeys = { alt: false, shift: false, ctrl: false, meta: false };
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ITEMS = 16;
const MAX_PATHS = 10_000;
const MAX_IMAGE = 512 * 1024;
const KIND = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;
const ABSOLUTE = /^(\/|~(\/|$)|[A-Za-z]:\/)/;
const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown, max: number) =>
  typeof value === "string" && value.length <= max ? value : undefined;

/** A bridge path a drop may name: absolute, no NUL, no `..` segment. */
export function readPath(value: unknown): string | undefined {
  const path = text(value, 4096);
  if (!path || path.includes("\0") || !ABSOLUTE.test(path)) return undefined;
  return path.split("/").includes("..") ? undefined : path;
}

function readItem(value: unknown): DeskData | undefined {
  const item = record(value);
  switch (item?.type) {
    case "desk/paths": {
      if (!Array.isArray(item.paths) || item.paths.length === 0 || item.paths.length > MAX_PATHS)
        return undefined;
      const paths: DeskPath[] = [];
      for (const entry of item.paths) {
        const path = readPath(record(entry)?.path);
        const kind = record(entry)?.kind;
        if (!path || (kind !== undefined && kind !== "file" && kind !== "folder")) return undefined;
        paths.push(kind ? { path, kind } : { path });
      }
      return { type: "desk/paths", paths };
    }
    case "desk/text":
    case "text/plain": {
      const said = text(item.text, MAX_BYTES);
      return said === undefined ? undefined : { type: item.type, text: said };
    }
    case "desk/uri": {
      const uri = text(item.uri, 8192);
      const title = item.title === undefined ? undefined : text(item.title, 1024);
      if (!uri || (item.title !== undefined && title === undefined)) return undefined;
      if (/^\s*(javascript|vbscript):/i.test(uri) || !URL.canParse(uri)) return undefined;
      return title === undefined ? { type: "desk/uri", uri } : { type: "desk/uri", uri, title };
    }
    case "desk/json": {
      const kind = text(item.kind, 128);
      if (!kind || !KIND.test(kind) || item.value === undefined) return undefined;
      return { type: "desk/json", kind, value: item.value };
    }
    default:
      return undefined;
  }
}

/** The type an item offers: `desk/json` carries its kind. */
export const typeOf = (item: DeskData) =>
  item.type === "desk/json" ? `desk/json:${item.kind}` : item.type;

/** The items of a drag, or undefined when one does not hold, a type repeats or they are too big. */
export function readItems(value: unknown): DeskData[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_ITEMS) return undefined;
  const items: DeskData[] = [];
  for (const entry of value) {
    const item = readItem(entry);
    if (!item || items.some((other) => typeOf(other) === typeOf(item))) return undefined;
    items.push(item);
  }
  try {
    if (JSON.stringify(items).length > MAX_BYTES) return undefined;
  } catch {
    return undefined;
  }
  return withFallback(items);
}

/** The plain text a drag offers when its source gave none: text, a URI, the paths, the JSON. */
export function withFallback(items: DeskData[]): DeskData[] {
  if (items.some((item) => item.type === "text/plain")) return items;
  const said = items.find((item) => item.type === "desk/text");
  const uri = items.find((item) => item.type === "desk/uri");
  const paths = items.find((item) => item.type === "desk/paths");
  const json = items.find((item) => item.type === "desk/json");
  const fallback =
    said?.text ??
    uri?.uri ??
    paths?.paths.map((p) => p.path).join("\n") ??
    (json ? JSON.stringify(json.value, null, 2) : undefined);
  return fallback === undefined ? items : [...items, { type: "text/plain", text: fallback }];
}

export function readEffects(value: unknown): DropEffect[] | undefined {
  if (value === undefined) return [...EFFECTS];
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const effects = EFFECTS.filter((effect) => value.includes(effect));
  return effects.length === value.length ? effects : undefined;
}

export const readAnswer = (value: unknown, allowed: readonly DropEffect[]): DropAnswer =>
  allowed.includes(value as DropEffect) ? (value as DropEffect) : "none";

export function readKeys(value: unknown): DragKeys {
  const keys = record(value) ?? {};
  return {
    alt: keys.alt === true,
    shift: keys.shift === true,
    ctrl: keys.ctrl === true,
    meta: keys.meta === true,
  };
}

/** The types a frame's targets accept: at most 32 short strings. */
export function readTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((t): t is string => typeof t === "string" && t.length <= 160).slice(0, 32);
}

/** Whether an accept pattern takes an offered type: `desk/json` takes every kind. */
const takes = (pattern: string, type: string) =>
  pattern === type || (pattern === "desk/json" && type.startsWith("desk/json:"));
export const taken = (accept: readonly string[], types: readonly string[]) =>
  types.filter((type) => accept.some((pattern) => takes(pattern, type)));

export function readImage(value: unknown): DragImage | undefined {
  const image = record(value);
  if (!image) return undefined;
  const label = text(image.label, 200);
  const detail = text(image.detail, 200);
  const src = text(image.src, MAX_IMAGE);
  return {
    ...(label ? { label } : {}),
    ...(detail ? { detail } : {}),
    ...(src && IMAGE.test(src) ? { src } : {}),
  };
}

const nameOf = (path: string) => path.replace(/\/+$/, "").split("/").pop() || path;

/** What the desk draws when the source drew nothing: a name, the text's start, the URI, the kind. */
export function imageOf(
  items: readonly DeskData[],
  given?: DragImage,
): DragImage & { count: number } {
  const first = items[0];
  const count = first?.type === "desk/paths" ? first.paths.length : 1;
  if (given?.label || given?.src) return { ...given, count };
  const label = !first
    ? ""
    : first.type === "desk/paths"
      ? nameOf(first.paths[0]?.path ?? "")
      : first.type === "desk/uri"
        ? (first.title ?? first.uri)
        : first.type === "desk/json"
          ? first.kind
          : (first.text.trim().split("\n")[0] ?? "");
  return { label: label.length > 60 ? `${label.slice(0, 59)}…` : label, count };
}
