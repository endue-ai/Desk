// The keys inside the Git surface, one table per view: single letters, as keyboard Git fronts do. Chords
// with Mod, Alt or Control are never taken (the desk's keymap gets them), apart from Mod+Enter in the
// commit editor. Pure: `actionFor` maps a key press to an action name, `hints` lists them for a view.

/**
 * @typedef {"status" | "log" | "diff" | "commit"} ViewName
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ key: string, action: string, label: string }} Binding
 */

/** @type {Binding[]} */
const MOVE = [
  { key: "ArrowDown", action: "next", label: "" },
  { key: "n", action: "next", label: "" },
  { key: "ArrowUp", action: "previous", label: "" },
  { key: "p", action: "previous", label: "" },
  { key: "Home", action: "first", label: "" },
  { key: "End", action: "last", label: "" },
];

/** @type {Record<ViewName, Binding[]>} */
export const BINDINGS = {
  status: [
    { key: "s", action: "stage", label: "stage" },
    { key: "S", action: "stageAll", label: "stage all" },
    { key: "u", action: "unstage", label: "unstage" },
    { key: "U", action: "unstageAll", label: "unstage all" },
    { key: "k", action: "discard", label: "discard" },
    { key: "c", action: "commit", label: "commit" },
    { key: "a", action: "amend", label: "amend" },
    { key: "d", action: "diff", label: "diff" },
    { key: "l", action: "log", label: "log" },
    { key: "f", action: "fetch", label: "fetch" },
    { key: "F", action: "pull", label: "pull" },
    { key: "P", action: "push", label: "push" },
    { key: "b", action: "checkout", label: "switch branch" },
    { key: "g", action: "refresh", label: "refresh" },
    { key: "Enter", action: "visit", label: "open" },
    { key: "Tab", action: "fold", label: "fold" },
    { key: "?", action: "help", label: "keys" },
    ...MOVE,
  ],
  log: [
    { key: "Enter", action: "diff", label: "show" },
    { key: "+", action: "more", label: "more" },
    { key: "a", action: "toggleAll", label: "all branches" },
    { key: "b", action: "checkout", label: "switch branch" },
    { key: "g", action: "refresh", label: "refresh" },
    { key: "q", action: "status", label: "back" },
    { key: "?", action: "help", label: "keys" },
    ...MOVE,
  ],
  diff: [
    { key: "s", action: "stage", label: "stage" },
    { key: "u", action: "unstage", label: "unstage" },
    { key: "Enter", action: "visit", label: "open" },
    { key: "Tab", action: "fold", label: "fold" },
    { key: "g", action: "refresh", label: "refresh" },
    { key: "q", action: "status", label: "back" },
    { key: "?", action: "help", label: "keys" },
    ...MOVE,
  ],
  commit: [
    { key: "Mod+Enter", action: "submitCommit", label: "commit" },
    { key: "Escape", action: "cancelCommit", label: "cancel" },
  ],
};

/**
 * The action a key press runs in a view, or undefined when the desk should have the key.
 * @param {ViewName} view
 * @param {KeyPress} press
 */
export function actionFor(view, press) {
  if (press.alt) return undefined;
  const name = press.mod ? `Mod+${press.key}` : press.key;
  if (press.mod && name !== "Mod+Enter") return undefined;
  return BINDINGS[view].find((binding) => binding.key === name)?.action;
}

/** The hint line of a view: "s stage · S stage all · …". */
export function hints(/** @type {ViewName} */ view) {
  return BINDINGS[view]
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
