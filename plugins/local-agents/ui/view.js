// The DOM of the Local agents surface: the header (how many agents were found, read-only or not,
// how many runs are going), tabs for the five views, each view's own renderer, the keys, a hint
// line, the list of keys `?` opens and a status live region. Chords with Mod are never prevented,
// so the desk's keymap gets them.

import { el } from "./dom.js";
import { actionFor, hints, keyList, VIEW_KEYS } from "./keys.js";
import { createActivityView } from "./view-activity.js";
import { createAgentsView } from "./view-agents.js";
import { createBoardView } from "./view-board.js";
import { createChatView, createCompareView } from "./view-chat.js";

/**
 * @typedef {import("./agents.js").View} View
 * @typedef {import("./agents.js").ViewName} ViewName
 * @typedef {import("./model.js").ViewModel} ViewModel
 * @typedef {import("./dom.js").Act} Act
 * @typedef {{ render(model: ViewModel): void, key?(action: string, args: unknown[]): boolean,
 *   focus(): void }} Section
 */

const TITLES = {
  agents: "Agents",
  chat: "Chat",
  compare: "Compare",
  board: "Board",
  activity: "Activity",
};

/**
 * @param {Document} doc
 * @param {Act} act Runs one of the controller's actions by name.
 * @returns {View & { current(): ViewName }}
 */
export function createView(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const tabs = byId("tabs");
  const foundEl = byId("found");
  const accessEl = byId("access");
  const busyEl = byId("busy");
  const hintsEl = byId("hints");
  const keysEl = byId("keys");
  const statusEl = byId("status");

  /** @type {Record<ViewName, Section>} */
  const sections = {
    agents: createAgentsView(doc, act),
    chat: createChatView(doc, act),
    compare: createCompareView(doc, act),
    board: createBoardView(doc, act),
    activity: createActivityView(doc, act),
  };
  /** @type {ViewName} */
  let current = "agents";
  let first = true;

  for (const [key, name] of Object.entries(VIEW_KEYS)) {
    const tab = doc.createElement("button");
    tab.type = "button";
    tab.className = "desk-tab";
    tab.id = `tab-${name}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `view-${name}`);
    tab.textContent = `${key} ${TITLES[name]}`;
    tab.addEventListener("click", () => void act("show", name));
    tabs.append(tab);
  }

  /** Show every key of the view in words, or hide the list. */
  const showKeys = (/** @type {boolean} */ on) => {
    keysEl.hidden = !on;
    if (!on) return keysEl.replaceChildren();
    keysEl.replaceChildren(
      el(doc, "h2", {}, `Keys in ${TITLES[current]}`),
      el(
        doc,
        "dl",
        {},
        ...keyList(current).flatMap(([keys, what]) => [
          el(doc, "dt", {}, el(doc, "kbd", {}, keys)),
          el(doc, "dd", {}, what),
        ]),
      ),
    );
  };

  /** @param {ViewModel} model */
  const render = (model) => {
    const changed = model.view !== current || first;
    current = model.view;
    first = false;
    for (const name of /** @type {ViewName[]} */ (Object.keys(sections))) {
      const on = name === current;
      byId(`view-${name}`).hidden = !on;
      const tab = byId(`tab-${name}`);
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    const checking = model.agents.some((a) => a.state === "checking");
    foundEl.textContent = checking
      ? "Looking for agent programs…"
      : `${model.found} of ${model.agents.length} agents installed`;
    accessEl.textContent =
      model.access === "read-only" ? "Read-only" : "Agents use their own permissions";
    accessEl.className = model.access === "read-only" ? "safe" : "open";
    busyEl.hidden = model.busy === 0;
    busyEl.textContent = `${model.busy} running`;
    busyEl.setAttribute("aria-label", `${model.busy} running`);
    sections[current].render(model);
    if (changed) {
      hintsEl.textContent = hints(current);
      if (!keysEl.hidden) showKeys(true);
    }
  };

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const tag = target?.tagName ?? "";
    if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") {
      if (event.key === "Escape" && target) target.blur();
      return;
    }
    if (event.key === "Escape" && !keysEl.hidden) {
      event.preventDefault();
      showKeys(false);
      return;
    }
    const press = actionFor(current, event);
    if (!press) return;
    event.preventDefault();
    if (press.action === "help") return showKeys(keysEl.hidden);
    if (sections[current].key?.(press.action, press.args ?? [])) return;
    void act(press.action, ...(press.args ?? []));
  });

  return {
    render,
    say(text) {
      statusEl.textContent = text;
    },
    current: () => current,
  };
}
