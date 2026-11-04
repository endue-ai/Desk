// Single-letter keys, read when the focus is not in a text field: 1–5 change the view, the rest
// work on what the view shows. Chords with Mod, Control or Alt are never taken, so the desk's
// keymap gets them.

/**
 * @typedef {import("./agents.js").ViewName} ViewName
 * @typedef {{ action: string, args?: unknown[] }} Press
 */

/** @type {Record<string, ViewName>} */
export const VIEW_KEYS = { 1: "agents", 2: "chat", 3: "compare", 4: "board", 5: "activity" };

/** @type {Record<ViewName, Record<string, string>>} */
const BY_VIEW = {
  agents: { r: "detect", Enter: "useSelected" },
  chat: {
    i: "focusComposer",
    "/": "focusComposer",
    n: "newChat",
    a: "pickAgent",
    m: "pickModel",
    x: "stopChat",
  },
  compare: { i: "focusComposer", "/": "focusComposer", x: "stopCompare" },
  board: {
    n: "newCard",
    r: "runSelected",
    x: "stopSelected",
    D: "removeSelected",
    a: "agentSelected",
    "[": "shiftLeft",
    "]": "shiftRight",
    C: "clearDone",
    Enter: "openSelected",
  },
  activity: { Enter: "openSelected", x: "stopSelected", X: "stopAll" },
};

const MOVES = {
  ArrowDown: "next",
  ArrowUp: "previous",
  ArrowLeft: "left",
  ArrowRight: "right",
  j: "next",
  k: "previous",
  h: "left",
  l: "right",
  Home: "first",
  End: "last",
};

/**
 * What a key does on a view, or undefined to let it be.
 * @param {ViewName} view
 * @param {{ key: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }} event
 * @returns {Press | undefined}
 */
export function actionFor(view, event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return undefined;
  const target = VIEW_KEYS[event.key];
  if (target) return { action: target };
  if (event.key === "?") return { action: "help" };
  const own = BY_VIEW[view][event.key];
  if (own) return { action: own };
  const move = /** @type {Record<string, string>} */ (MOVES)[event.key];
  if (move && (view === "board" || view === "activity" || view === "agents"))
    return { action: "move", args: [move] };
  return undefined;
}

/** The hint line for a view. */
export function hints(/** @type {ViewName} */ view) {
  const common = "1–5 views · ? keys";
  switch (view) {
    case "agents":
      return `↑↓ pick · ↵ chat with it · r look again · ${common}`;
    case "chat":
      return `i write · ↵ send · ⇧↵ new line · n new conversation · a agent · m model · x stop · ${common}`;
    case "compare":
      return `i write · ↵ ask every agent picked · x stop · ${common}`;
    case "board":
      return `←→↑↓ pick · n new card · r run · [ ] move · a agent · ↵ open · x stop · D remove · C clear Done · ${common}`;
    case "activity":
      return `↑↓ pick · ↵ open · x stop · X stop all · ${common}`;
  }
  return common;
}
