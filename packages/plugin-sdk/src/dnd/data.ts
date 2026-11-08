// Desk data without the DOM: the type each item offers, which types a target takes, the text
// fallback, and the effect a drop performs. The runtime keeps its own copy at the trust boundary
// (packages/runtime/src/dnd/data.ts); this one serves the SDK and its test host.
import type {
  DeskData,
  DragKeys,
  DragOver,
  Drop,
  DropAnswer,
  DropEffect,
  DropOptions,
} from "./types";

export const EFFECTS: readonly DropEffect[] = ["copy", "move", "link"];
/** Every type a target without `accept` takes. */
export const ALL_TYPES = ["desk/paths", "desk/text", "desk/uri", "desk/json", "text/plain"];
export const NO_KEYS: DragKeys = { alt: false, shift: false, ctrl: false, meta: false };

/** The type an item offers: `desk/json` carries its kind (`desk/json:db/rows`). */
export function typeOf(item: DeskData): string {
  return item.type === "desk/json" ? `desk/json:${item.kind}` : item.type;
}

/** Whether an accept pattern takes an offered type: `desk/json` takes every kind. */
export function takes(pattern: string, type: string): boolean {
  return pattern === type || (pattern === "desk/json" && type.startsWith("desk/json:"));
}

/** The offered types that one of `accept` takes, in the order offered. */
export function taken(accept: readonly string[], types: readonly string[]): string[] {
  return types.filter((type) => accept.some((pattern) => takes(pattern, type)));
}

/** The plain text a drag says when nothing better is offered. */
export function plainText(items: readonly DeskData[]): string | undefined {
  for (const item of items)
    if (item.type === "text/plain" || item.type === "desk/text") return item.text;
  for (const item of items) {
    if (item.type === "desk/uri") return item.uri;
    if (item.type === "desk/paths") return item.paths.map((p) => p.path).join("\n");
  }
  const json = items.find((item) => item.type === "desk/json");
  return json ? JSON.stringify(json.value, null, 2) : undefined;
}

/** The items with the `text/plain` fallback added when they do not offer it. */
export function withFallback(items: readonly DeskData[]): DeskData[] {
  if (items.some((item) => item.type === "text/plain")) return [...items];
  const text = plainText(items);
  return text === undefined ? [...items] : [...items, { type: "text/plain", text }];
}

/**
 * The effect a drop performs when the target does not say: Alt copies, Mod (Meta or Control) moves,
 * both link (as Finder does); otherwise the first effect the target prefers that the source allows.
 */
export function chooseEffect(
  allowed: readonly DropEffect[],
  keys: DragKeys,
  preferred: readonly DropEffect[] = EFFECTS,
): DropAnswer {
  const mod = keys.meta || keys.ctrl;
  const asked: DropEffect | undefined =
    keys.alt && mod ? "link" : keys.alt ? "copy" : mod ? "move" : undefined;
  if (asked) return allowed.includes(asked) ? asked : "none";
  return preferred.find((effect) => allowed.includes(effect)) ?? "none";
}

/** The effect a target answers for a hover: its own `effect`, else the keys and its preferences. */
export function answerFor(over: DragOver, options: DropOptions): DropAnswer {
  const said = options.effect?.(over);
  const effect = said ?? chooseEffect(over.effectAllowed, over.keys, options.effects);
  return effect === "none" || over.effectAllowed.includes(effect) ? effect : "none";
}

/** The drop a handler receives: the hover's facts, the effect, the items and their readers. */
export function dropOf(over: DragOver, effect: DropEffect, items: DeskData[]): Drop {
  const paths = items.find((item) => item.type === "desk/paths");
  const uri = items.find((item) => item.type === "desk/uri");
  const text =
    items.find((item) => item.type === "desk/text") ??
    items.find((item) => item.type === "text/plain");
  return {
    ...over,
    effect,
    items,
    ...(paths ? { paths: paths.paths } : {}),
    ...(text && "text" in text ? { text: text.text } : {}),
    ...(uri ? { uri: uri.uri } : {}),
    json: (kind) =>
      items.flatMap((item) =>
        item.type === "desk/json" && (kind === undefined || item.kind === kind) ? [item.value] : [],
      ),
  };
}
