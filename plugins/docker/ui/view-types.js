// What the controller asks of a view (view.js draws it; the tests' recording view records it), and
// what it hands over: the lists by name, the logs, the pane, resource use, each list's query and sort.

/**
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {(typeof import("./keys.js").LISTS)[number]} ListName
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./logs.js").LogModel & { timestamps: boolean, filter: string }} LogsView
 * @typedef {((id: string) => import("./stats.js").Snapshot | undefined) &
 *   { latest(): Map<string, import("./parse-engine.js").Stats> }} StatsRead
 * @typedef {{
 *   header(header: import("./engine.js").Header): void,
 *   show(view: ViewName, hints: string): void,
 *   list(view: ListName, model: unknown): void,
 *   logs(model: LogsView): void,
 *   detail(model: import("./inspect.js").Detail | null): void,
 *   pane(model: import("./pane.js").PaneModel | null): void,
 *   stats(read: StatsRead): void,
 *   prefs(list: string, prefs: import("./query.js").Prefs): void,
 *   say(text: string): void,
 *   busy(running: number): void,
 *   focus(): void,
 *   selection(): Item | undefined,
 *   marked(): Item[],
 *   setMarks(items: Item[]): void,
 * }} View
 */

export {};
