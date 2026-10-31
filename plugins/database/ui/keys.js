// The keys inside the Database surface, one table per area. The explorer and the grid take single
// keys; the editor takes Mod+Enter (run the statement) and Mod+Shift+Enter (run the script), and
// Escape only while a run goes on. Every other chord with Mod, Alt or Control is left to the desk.
// Pure: `actionFor` maps a key press to an action name, `hints` lists an area's keys.

/**
 * @typedef {"explorer" | "editor" | "grid"} Area
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ chord: string, action: string, label: string }} Binding
 */

/** @type {Record<Area, Binding[]>} */
export const BINDINGS = {
  explorer: [
    { chord: "Enter", action: "activate", label: "open" },
    { chord: "ArrowRight", action: "expand", label: "" },
    { chord: "ArrowLeft", action: "collapse", label: "" },
    { chord: "ArrowDown", action: "next", label: "" },
    { chord: "ArrowUp", action: "previous", label: "" },
    { chord: "Home", action: "first", label: "" },
    { chord: "End", action: "last", label: "" },
    { chord: "n", action: "create", label: "new" },
    { chord: "e", action: "edit", label: "edit" },
    { chord: "Delete", action: "remove", label: "remove" },
    { chord: "g", action: "refresh", label: "refresh" },
    { chord: "u", action: "importUri", label: "from URI" },
  ],
  editor: [
    { chord: "Mod+Enter", action: "run", label: "run statement" },
    { chord: "Mod+Shift+Enter", action: "runAll", label: "run script" },
    { chord: "Escape", action: "cancel", label: "cancel" },
  ],
  grid: [
    { chord: "ArrowDown", action: "down", label: "" },
    { chord: "ArrowUp", action: "up", label: "" },
    { chord: "ArrowRight", action: "right", label: "" },
    { chord: "ArrowLeft", action: "left", label: "" },
    { chord: "PageDown", action: "pageDown", label: "" },
    { chord: "PageUp", action: "pageUp", label: "" },
    { chord: "Home", action: "home", label: "" },
    { chord: "End", action: "end", label: "" },
    { chord: "s", action: "sort", label: "sort" },
    { chord: "Enter", action: "value", label: "full value" },
    { chord: "m", action: "more", label: "more rows" },
    { chord: "[", action: "previousTab", label: "" },
    { chord: "]", action: "nextTab", label: "" },
    { chord: "Escape", action: "editor", label: "back" },
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
  return BINDINGS[area].find((binding) => binding.chord === plain)?.action;
}

/** Shift with an arrow extends the grid's selection. */
export const extending = (/** @type {KeyPress} */ press) =>
  press.shift && !press.mod && press.key.startsWith("Arrow");

/** The hint line of an area: "Enter open · n new · …". */
export function hints(/** @type {Area} */ area) {
  return BINDINGS[area]
    .filter((binding) => binding.label !== "")
    .map((binding) => `${binding.chord} ${binding.label}`)
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
