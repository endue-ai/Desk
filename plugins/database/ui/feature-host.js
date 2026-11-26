// The plugin's features (features/index.js, features/README.md), each a folder that declares its
// commands, its actions, its panels and its dialogs. A command answers through answer.js as the
// built-in ones do (a failure on the status line, a cancel quiet), an action joins the view's
// actions under the same guard, a panel type is a buffer kind of its own (panels.js) that the view
// draws into its one box (view-panel.js), and a dialog asks the person over the page
// (view-dialog.js). Nothing is claimed twice. No DOM.

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
 *   label: string,
 *   render(doc: Document, model: any, done: (answer?: unknown) => void): HTMLElement,
 * }} Dialog
 *   `render` draws a model as a form in the page's dialog look and calls `done` once: with the
 *   answer, or with nothing when the person cancels (the view adds Escape).
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
 *   runner: ReturnType<typeof import("./run.js").createRunner>,
 *   clients: ReturnType<typeof import("./clients.js").createClients>,
 *   startWorker?: import("./explain/reader.js").StartWorker,
 *   settings(): import("./settings.js").Settings,
 *   onSettings(listener: (settings: import("./settings.js").Settings) => void): () => void,
 *   pick: import("./ask.js").Pick,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   say(text: string): void,
 *   guard: ReturnType<typeof import("./answer.js").guarded>,
 *   cancelled(message: string): Error,
 *   dialog(type: string, model: unknown): Promise<unknown>,
 *   drop(item: import("./drops.js").Dropped, into?: import("./importer.js").Into & { format?: import("./import-copy/wizard.js").CopyFormat }): Promise<unknown>,
 * }} Deps
 *   `execute` runs SQL under the read-only, production and agent guards; every write goes through
 *   it. `dialog` shows a feature's dialog and resolves with its answer (undefined: cancelled);
 *   `drop` carries out a file or text as a drop on the page does (dropped.js).
 *   `onSettings` calls its listener with the settings after each change while the plugin runs, until
 *   the function it returns is called.
 *   `runner` runs a program as the clients run (features/backup/), `clients` finds it, and
 *   `startWorker` starts a feature's worker (absent in tests: read in place).
 * @typedef {{
 *   id: string,
 *   commands?(deps: Deps): Record<string, (args: Record<string, any>, invocation?: import("@endue-ai/plugin-sdk").Invocation) => unknown>,
 *   actions?(deps: Deps): Record<string, (...args: any[]) => unknown>,
 *   panels?: Record<string, Panel>,
 *   dialogs?: Record<string, Dialog>,
 *   styles?: string[],
 * }} Feature
 *   `commands` by id (each in plugin.json); `actions` by the name a panel or a key calls; `styles`
 *   the URLs of the feature's stylesheets, which the view links once.
 */

/** The kinds of the built-in buffers and the fields every buffer has: no panel type is one. */
const KINDS = "console table ddl";
const FIELDS =
  "id kind connection name text execution shown running tab maxRows edit page consoleId number title file visited used filing explained pinned";
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
 * Every feature's dialogs, by type.
 * @param {Feature[]} features
 * @returns {Record<string, Dialog>}
 */
export function dialogsOf(features) {
  /** @type {Record<string, Dialog>} */
  const dialogs = {};
  for (const feature of features)
    for (const [type, dialog] of Object.entries(feature.dialogs ?? {})) {
      if (Object.hasOwn(dialogs, type))
        throw new Error(`${feature.id}: the dialog ${type} is taken.`);
      dialogs[type] = dialog;
    }
  return dialogs;
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
