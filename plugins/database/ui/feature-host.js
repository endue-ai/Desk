// The plugin's features (features/index.js, features/README.md), each a folder that declares its
// commands, its actions and its panels. A command answers through answer.js as the built-in ones
// do (a failure on the status line, a cancel quiet), an action joins the view's actions under the
// same guard, and a panel type is a buffer kind of its own (panels.js) that the view draws into
// its one box (view-panel.js). Nothing is claimed twice. No DOM.

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 * @typedef {{ id: string, connection: string, name: string }} PanelBuffer
 * @typedef {{ el: HTMLElement, update?(state: any): void, destroy?(): void }} PanelHandle
 * @typedef {{
 *   label: string,
 *   render(doc: Document, state: any, act: Act, buffer: PanelBuffer): HTMLElement | PanelHandle,
 *   keep?(state: any): unknown,
 * }} Panel
 *   `label` names the box for a screen reader; `render` draws a state (`update`, when given, takes
 *   the next state of the same buffer in place); `keep` says what of a state comes back after a
 *   restart (small JSON), and nothing comes back when it returns undefined or is missing.
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   commands: { run(id: string, args?: unknown): Promise<unknown> },
 *   view: import("./database.js").View,
 *   manager: ReturnType<typeof import("./manage.js").createManager>,
 *   consoles: ReturnType<typeof import("./consoles.js").createConsoles>,
 *   catalog: ReturnType<typeof import("./catalog.js").createCatalog>,
 *   explorer: ReturnType<typeof import("./explorer.js").createExplorer>,
 *   tools: ReturnType<typeof import("./tools.js").createTools>,
 *   execute: import("./catalog.js").Execute,
 *   settings(): import("./settings.js").Settings,
 *   pick: import("./ask.js").Pick,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   say(text: string): void,
 *   guard: ReturnType<typeof import("./answer.js").guarded>,
 *   cancelled(message: string): Error,
 * }} Deps
 *   `execute` runs SQL under the read-only, production and agent guards; every write goes through it.
 * @typedef {{
 *   id: string,
 *   commands?(deps: Deps): Record<string, (args: Record<string, any>) => unknown>,
 *   actions?(deps: Deps): Record<string, (...args: any[]) => unknown>,
 *   panels?: Record<string, Panel>,
 *   styles?: string[],
 * }} Feature
 *   `commands` by id (each in plugin.json); `actions` by the name a panel or a key calls; `styles`
 *   the URLs of the feature's stylesheets, which the view links once.
 */

/** The kinds of the built-in buffers and the fields every buffer has: no panel type is one. */
const KINDS = "console table ddl";
const FIELDS =
  "id kind connection name text execution shown running tab maxRows edit page consoleId number title file visited used filing";
export const RESERVED = new Set(`${KINDS} ${FIELDS}`.split(" "));

/**
 * Every feature's panel types, by type.
 * @param {Feature[]} features
 * @returns {Record<string, Panel>}
 */
export function panelsOf(features) {
  /** @type {Record<string, Panel>} */
  const panels = {};
  for (const feature of features)
    for (const [type, panel] of Object.entries(feature.panels ?? {})) {
      if (RESERVED.has(type)) throw new Error(`${feature.id}: ${type} is a built-in buffer's.`);
      if (Object.hasOwn(panels, type))
        throw new Error(`${feature.id}: the panel ${type} is taken.`);
      panels[type] = panel;
    }
  return panels;
}

/**
 * Answer every feature's commands and gather its actions, guarded.
 * @param {Feature[]} features
 * @param {Deps} deps
 * @param {{ answer: import("./answer.js").Answer, taken: Set<string> }} host The plugin's answer
 *   and the names of the built-in actions.
 */
export function registerFeatures(features, deps, { answer, taken }) {
  /** @type {Record<string, (...args: unknown[]) => Promise<unknown>>} */
  const actions = {};
  for (const feature of features) {
    for (const [id, handler] of Object.entries(feature.commands?.(deps) ?? {})) answer(id, handler);
    for (const [name, fn] of Object.entries(feature.actions?.(deps) ?? {})) {
      if (taken.has(name) || Object.hasOwn(actions, name))
        throw new Error(`${feature.id}: the action ${name} is taken.`);
      actions[name] = deps.guard(fn);
    }
  }
  return actions;
}
