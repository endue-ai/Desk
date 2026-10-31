// The keys inside the Docker surface, one table per view: single letters, as keyboard container
// tools do, and 1 to 6 to switch lists. Chords with Mod, Alt or Control are never taken (the desk's
// keymap gets them). Pure: `actionFor` maps a key press to an action name, `hints` lists them.

/**
 * @typedef {"containers" | "compose" | "images" | "volumes" | "networks" | "system" | "logs" | "inspect"} ViewName
 * @typedef {{ key: string, mod: boolean, shift: boolean, alt: boolean }} KeyPress
 * @typedef {{ key: string, action: string, label: string }} Binding
 */

/** The lists, in the order of their number keys. */
export const LISTS = /** @type {const} */ ([
  "containers",
  "compose",
  "images",
  "volumes",
  "networks",
  "system",
]);

/** @type {Binding[]} */
const MOVE = [
  { key: "ArrowDown", action: "next", label: "" },
  { key: "n", action: "next", label: "" },
  { key: "ArrowUp", action: "previous", label: "" },
  { key: "p", action: "previous", label: "" },
  { key: "Home", action: "first", label: "" },
  { key: "End", action: "last", label: "" },
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

/** @type {Record<ViewName, Binding[]>} */
export const BINDINGS = {
  containers: [
    { key: "s", action: "start", label: "start" },
    { key: "x", action: "stop", label: "stop" },
    { key: "r", action: "restart", label: "restart" },
    { key: "P", action: "togglePause", label: "pause" },
    { key: "K", action: "kill", label: "kill" },
    { key: "D", action: "remove", label: "remove" },
    { key: "l", action: "logs", label: "logs" },
    { key: "e", action: "shell", label: "shell" },
    { key: "Enter", action: "inspect", label: "detail" },
    { key: "i", action: "inspect", label: "" },
    { key: "a", action: "toggleAll", label: "all/running" },
    { key: "Tab", action: "fold", label: "fold" },
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
    ...COMMON,
  ],
  images: [
    { key: "R", action: "run", label: "run" },
    { key: "U", action: "pull", label: "pull" },
    { key: "D", action: "removeImage", label: "remove" },
    { key: "X", action: "pruneImages", label: "prune" },
    ...COMMON,
  ],
  volumes: [
    { key: "D", action: "removeVolume", label: "remove" },
    { key: "X", action: "pruneVolumes", label: "prune" },
    ...COMMON,
  ],
  networks: [
    { key: "D", action: "removeNetwork", label: "remove" },
    { key: "X", action: "pruneNetworks", label: "prune" },
    ...COMMON,
  ],
  system: [
    { key: "c", action: "switchContext", label: "context" },
    { key: "X", action: "pruneSystem", label: "clean up" },
    ...COMMON,
  ],
  logs: [
    { key: "f", action: "toggleFollow", label: "follow" },
    { key: "t", action: "toggleTimestamps", label: "times" },
    { key: "/", action: "filter", label: "filter" },
    { key: "c", action: "clearLogs", label: "clear" },
    { key: "q", action: "back", label: "back" },
    { key: "g", action: "refresh", label: "reload" },
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
    { key: "Tab", action: "fold", label: "fold" },
    { key: "q", action: "back", label: "back" },
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

/** The hint line of a view: "s start · x stop · …", then "1–6 lists" where they switch. */
export function hints(/** @type {ViewName} */ view) {
  const keys = BINDINGS[view]
    .filter((binding) => binding.label !== "")
    .map((binding) => `${binding.key === "Enter" ? "↵" : binding.key} ${binding.label}`);
  if (BINDINGS[view].some((binding) => binding.key === "1")) keys.push("1–6 lists");
  return keys.join(" · ");
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
