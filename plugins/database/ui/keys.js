// The keys inside the Database surface, one table per area. The explorer and the grid take single
// keys; the editor takes Mod+Enter (run the statement) and Mod+Shift+Enter (run the script), and
// Escape only while a run goes on. Every other chord with Mod, Alt or Control is left to the desk.
// Pure: `actionFor` maps a key press to an action name, `hints` lists an area's keys.

/**
 * @typedef {"explorer" | "editor" | "grid"} Area
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ key: string, action: string, label: string }} Binding
 */

/** @type {Record<Area, Binding[]>} */
export const BINDINGS = {
  explorer: [
    { key: "Enter", action: "activate", label: "open" },
    { key: "ArrowRight", action: "expand", label: "" },
    { key: "ArrowLeft", action: "collapse", label: "" },
    { key: "ArrowDown", action: "next", label: "" },
    { key: "ArrowUp", action: "previous", label: "" },
    { key: "Home", action: "first", label: "" },
    { key: "End", action: "last", label: "" },
    { key: "n", action: "create", label: "new" },
    { key: "e", action: "edit", label: "edit" },
    { key: "Delete", action: "remove", label: "remove" },
    { key: "g", action: "refresh", label: "refresh" },
    { key: "u", action: "importUri", label: "from URI" },
  ],
  editor: [
    { key: "Mod+Enter", action: "run", label: "run statement" },
    { key: "Mod+Shift+Enter", action: "runAll", label: "run script" },
    { key: "Escape", action: "cancel", label: "cancel" },
  ],
  grid: [
    { key: "ArrowDown", action: "down", label: "" },
    { key: "ArrowUp", action: "up", label: "" },
    { key: "ArrowRight", action: "right", label: "" },
    { key: "ArrowLeft", action: "left", label: "" },
    { key: "PageDown", action: "pageDown", label: "" },
    { key: "PageUp", action: "pageUp", label: "" },
    { key: "Home", action: "home", label: "" },
    { key: "End", action: "end", label: "" },
    { key: "s", action: "sort", label: "sort" },
    { key: "Enter", action: "value", label: "full value" },
    { key: "m", action: "more", label: "more rows" },
    { key: "[", action: "previousTab", label: "" },
    { key: "]", action: "nextTab", label: "" },
    { key: "Escape", action: "editor", label: "back" },
  ],
};

/** Chords this surface keeps from the desk, by area. */
const CHORDS = new Set(["Mod+Enter", "Mod+Shift+Enter"]);

/**
 * The action a key press runs in an area, or undefined when the desk (or the field) should have it.
 * @param {Area} area
 * @param {KeyPress} press
 * @param {{ running?: boolean }} [state]
 */
export function actionFor(area, press, state = {}) {
  if (press.alt) return undefined;
  const name = `${press.mod ? "Mod+" : ""}${press.mod && press.shift ? "Shift+" : ""}${press.key}`;
  if (press.mod && !CHORDS.has(name)) return undefined;
  if (area === "editor" && name === "Escape" && !state.running) return undefined;
  const plain = press.shift && !press.mod && press.key.length > 1 ? undefined : name;
  return BINDINGS[area].find((binding) => binding.key === plain)?.action;
}

/** Shift with an arrow extends the grid's selection. */
export const extending = (/** @type {KeyPress} */ press) =>
  press.shift && !press.mod && press.key.startsWith("Arrow");

/** The hint line of an area: "Enter open · n new · …". */
export function hints(/** @type {Area} */ area) {
  return BINDINGS[area]
    .filter((binding) => binding.label !== "")
    .map((binding) => `${binding.key} ${binding.label}`)
    .join(" · ");
}

/**
 * A DOM keyboard event as a key press. Mod is Meta on macOS and Control elsewhere; either counts.
 * @param {{ key: string, metaKey: boolean, ctrlKey: boolean, shiftKey: boolean, altKey: boolean }} event
 * @returns {KeyPress}
 */
export function pressOf(event) {
  return {
    key: event.key,
    mod: event.metaKey || event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  };
}
