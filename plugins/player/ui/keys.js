// The transport's keys inside the surface, without the DOM: which action a key press is, given what
// has the focus. Chords with Mod, Ctrl or Alt are never the player's, so the desk's keymap gets them;
// a focused button keeps Space and Enter, a menu and the volume slider keep their own keys.

/**
 * @typedef {"toggle" | "back5" | "forward5" | "back10" | "forward10" | "louder" | "quieter" | "mute"
 *   | "start" | "end" | "previous" | "next" | "theatre" | "leave" | "slower" | "faster" | "earlier"
 *   | "later"} Action
 * @typedef {{ key: string, metaKey?: boolean, ctrlKey?: boolean, altKey?: boolean }} Press
 * @typedef {{ tag: string, type?: string, id?: string }} Focus
 */

/** @type {Record<string, Action>} */
const KEYS = {
  " ": "toggle",
  k: "toggle",
  K: "toggle",
  ArrowLeft: "back5",
  ArrowRight: "forward5",
  j: "back10",
  J: "back10",
  l: "forward10",
  L: "forward10",
  ArrowUp: "louder",
  ArrowDown: "quieter",
  m: "mute",
  M: "mute",
  Home: "start",
  End: "end",
  PageUp: "previous",
  PageDown: "next",
  t: "theatre",
  T: "theatre",
  Escape: "leave",
  "<": "slower",
  ">": "faster",
  "[": "earlier",
  "]": "later",
};

/** Keys a range input moves by itself. */
const SLIDER = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * @param {Press} press
 * @param {Focus} focus
 * @returns {Action | null}
 */
export function actionFor(press, focus) {
  if (press.metaKey || press.ctrlKey || press.altKey) return null;
  const action = KEYS[press.key];
  if (!action) return null;
  if (action === "leave") return action;
  const tag = focus.tag.toUpperCase();
  if (tag === "SELECT" || tag === "TEXTAREA") return null;
  if (tag === "INPUT" && focus.type !== "range") return null;
  if (tag === "INPUT" && focus.id !== "seek" && SLIDER.has(press.key)) return null;
  if (
    (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") &&
    (press.key === " " || press.key === "Enter")
  )
    return null;
  return action;
}
