// The keys inside the Docker surface, one table per view: single letters, as keyboard container
// tools do, 1 to 6 to switch lists, [ and ] to switch the pane's tabs. Chords with Mod or Alt are
// never taken (the desk's keymap gets them), and Tab is left to move between the list and the pane.
// Pure: `actionFor` maps a key press to an action name, `hints` lists them.

/**
 * @typedef {"overview" | "containers" | "compose" | "images" | "volumes" | "networks" | "logs" | "inspect"} ViewName
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ key: string, action: string, label: string }} Binding
 */

/** The lists, in the order of their number keys. */
export const LISTS = /** @type {const} */ ([
  "overview",
  "containers",
  "compose",
  "images",
  "volumes",
  "networks",
]);

/** Actions the view answers itself, without the controller. */
export const VIEW_ONLY = new Set([
  ...["next", "previous", "first", "last", "pageDown", "pageUp", "collapse", "expand"],
  ...["activate", "mark", "markAll", "escape", "search", "end", "top", "toggleWrap"],
  ...["prevTab", "nextTab", "up"],
]);

/** @type {Binding[]} */
const MOVE = [
  { key: "ArrowDown", action: "next", label: "" },
  { key: "n", action: "next", label: "" },
  { key: "ArrowUp", action: "previous", label: "" },
  { key: "p", action: "previous", label: "" },
  { key: "Home", action: "first", label: "" },
  { key: "End", action: "last", label: "" },
  { key: "PageDown", action: "pageDown", label: "" },
  { key: "PageUp", action: "pageUp", label: "" },
  { key: "ArrowLeft", action: "collapse", label: "" },
  { key: "ArrowRight", action: "expand", label: "" },
];

/** @type {Binding[]} */
const SWITCH = LISTS.map((name, index) => ({ key: String(index + 1), action: name, label: "" }));

/** @type {Binding[]} */
const COMMON = [
  { key: "g", action: "refresh", label: "refresh" },
  { key: "?", action: "help", label: "keys" },
  ...SWITCH,
  ...MOVE,
];

/** Search, marks and sort, over every list but the overview. @type {Binding[]} */
const LIST = [
  { key: "/", action: "search", label: "search" },
  { key: " ", action: "mark", label: "" },
  { key: "M", action: "markAll", label: "mark all" },
  { key: "S", action: "nextSort", label: "sort" },
  { key: "Z", action: "reverseSort", label: "reverse" },
  { key: "Escape", action: "escape", label: "" },
];

/** The pane's tabs and the way back to the list. @type {Binding[]} */
const PANE = [
  { key: "[", action: "prevTab", label: "" },
  { key: "]", action: "nextTab", label: "tabs" },
  { key: "q", action: "back", label: "back" },
  { key: "Escape", action: "escape", label: "" },
];

/** @type {Record<ViewName, Binding[]>} */
export const BINDINGS = {
  overview: [
    { key: "Enter", action: "activate", label: "open" },
    { key: "c", action: "switchContext", label: "context" },
    { key: "X", action: "pruneSystem", label: "clean up" },
    ...COMMON,
  ],
  containers: [
    { key: "s", action: "start", label: "start" },
    { key: "x", action: "stop", label: "stop" },
    { key: "r", action: "restart", label: "restart" },
    { key: "P", action: "togglePause", label: "pause" },
    { key: "K", action: "kill", label: "kill" },
    { key: "D", action: "remove", label: "remove" },
    { key: "l", action: "logs", label: "logs" },
    { key: "e", action: "shell", label: "shell" },
    { key: "w", action: "openPort", label: "browser" },
    { key: "Enter", action: "inspect", label: "detail" },
    { key: "i", action: "inspect", label: "" },
    { key: "a", action: "toggleAll", label: "all/running" },
    ...LIST,
    ...COMMON,
  ],
  compose: [
    { key: "u", action: "up", label: "up" },
    { key: "D", action: "down", label: "down" },
    { key: "s", action: "composeStart", label: "start" },
    { key: "x", action: "composeStop", label: "stop" },
    { key: "r", action: "composeRestart", label: "restart" },
    { key: "U", action: "composePull", label: "pull" },
    { key: "l", action: "logs", label: "logs" },
    { key: "o", action: "openFile", label: "open file" },
    { key: "Enter", action: "activate", label: "" },
    ...LIST,
    ...COMMON,
  ],
  images: [
    { key: "Enter", action: "openImage", label: "detail" },
    { key: "h", action: "history", label: "history" },
    { key: "R", action: "run", label: "run" },
    { key: "U", action: "pull", label: "pull" },
    { key: "B", action: "build", label: "build" },
    { key: "D", action: "removeImage", label: "remove" },
    { key: "X", action: "pruneImages", label: "prune" },
    ...LIST,
    ...COMMON,
  ],
  volumes: [
    { key: "D", action: "removeVolume", label: "remove" },
    { key: "X", action: "pruneVolumes", label: "prune" },
    ...LIST,
    ...COMMON,
  ],
  networks: [
    { key: "D", action: "removeNetwork", label: "remove" },
    { key: "X", action: "pruneNetworks", label: "prune" },
    ...LIST,
    ...COMMON,
  ],
  logs: [
    { key: "f", action: "toggleFollow", label: "follow" },
    { key: "t", action: "toggleTimestamps", label: "times" },
    { key: "w", action: "toggleWrap", label: "wrap" },
    { key: "/", action: "search", label: "search" },
    { key: "c", action: "clearLogs", label: "clear" },
    { key: "g", action: "refresh", label: "reload" },
    ...PANE,
    { key: "?", action: "help", label: "keys" },
    { key: "End", action: "end", label: "" },
    { key: "Home", action: "top", label: "" },
  ],
  inspect: [
    { key: "s", action: "start", label: "start" },
    { key: "x", action: "stop", label: "stop" },
    { key: "r", action: "restart", label: "restart" },
    { key: "D", action: "remove", label: "remove" },
    { key: "l", action: "logs", label: "logs" },
    { key: "e", action: "shell", label: "shell" },
    { key: "w", action: "openPort", label: "browser" },
    { key: "Enter", action: "activate", label: "" },
    { key: "Backspace", action: "up", label: "" },
    { key: "y", action: "copyOut", label: "copy out" },
    { key: "Y", action: "copyIn", label: "copy in" },
    ...PANE,
    ...COMMON,
  ],
};

/**
 * The action a key press runs in a view, or undefined when the desk should have the key.
 * @param {ViewName} view
 * @param {KeyPress} press
 */
export function actionFor(view, press) {
  if (press.alt || press.mod) return undefined;
  return BINDINGS[view].find((binding) => binding.key === press.key)?.action;
}

const KEY_NAMES = /** @type {Record<string, string>} */ ({ Enter: "↵", " ": "Space" });

/** The hint line of a view: "s start · x stop · …", then "1–6 lists" where they switch. */
export function hints(/** @type {ViewName} */ view) {
  const keys = BINDINGS[view]
    .filter((binding) => binding.label !== "")
    .map((binding) => `${KEY_NAMES[binding.key] ?? binding.key} ${binding.label}`);
  if (BINDINGS[view].some((binding) => binding.key === "1")) keys.push("1–6 lists");
  return keys.join(" · ");
}

/** Every labelled key of a view, for the keys panel `?` opens: [key, what it does]. */
export function keyTable(/** @type {ViewName} */ view) {
  const named = BINDINGS[view].filter((b) => b.label !== "");
  return [
    ...named.map((b) => [KEY_NAMES[b.key] ?? b.key, b.label]),
    ...(["logs", "inspect", "overview"].includes(view)
      ? []
      : [
          ["Space", "mark"],
          ["← →", "fold"],
        ]),
    ["↑ ↓", "move"],
    ["Tab", "list ⇄ pane"],
  ];
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
