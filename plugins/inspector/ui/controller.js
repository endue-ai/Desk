// The inspector without its DOM: it reads the section in view from the bridge, keeps it fresh,
// filters it and exports it. It talks only to the bridge, the command registry and a view, so the
// SDK's test host runs it with a recording view and a timer the test ticks.
import { filtered, tableOf } from "./model.js";
import { exported, fetchSection, LABELS, RUNTIME, SECTIONS } from "./sections.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./sections.js").Section} Section
 * @typedef {import("./model.js").Table} Table
 * @typedef {{ sections(list: Array<{ id: Section, label: string }>, current: Section): void,
 *   table(table: Table): void, status(text: string): void, exported(text: string): void }} View
 * @typedef {{ every(ms: number, tick: () => void): () => void }} Timers
 */

/** How often the section in view is read again: the runtime's are invocations, so less often. */
const EVERY_MS = 2000;
const RUNTIME_EVERY_MS = 5000;
const FIRST = /** @type {Section} */ ("commands");
const LIST = SECTIONS.map((id) => ({ id, label: LABELS[id] }));

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
const isSection = (/** @type {unknown} */ id) => SECTIONS.includes(/** @type {Section} */ (id));

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {Timers} timers
 */
export function createInspector({ bridge, commands, state }, view, { every }) {
  const kept = /** @type {{ section?: unknown } | undefined} */ (state.get())?.section;
  let current = isSection(kept) ? /** @type {Section} */ (kept) : FIRST;
  let query = "";
  /** @type {Table | null} */
  let table = null;
  let stop = () => {};
  let reading = 0;
  let busy = false;
  let failed = false;
  /** @type {import("./sections.js").Sources} */
  const sources = {
    call: (method, params) =>
      bridge.call(/** @type {never} */ (method), /** @type {never} */ (params)),
    run: (id, args) => commands.run(id, args),
  };

  const draw = () => {
    if (table) view.table(filtered(table, query));
  };

  /** Read the section in view again; a newer read wins over an older one. */
  const refresh = async () => {
    const section = current;
    const mine = ++reading;
    busy = true;
    try {
      const data = await fetchSection(section, sources);
      if (mine !== reading) return;
      table = tableOf(section, data);
      draw();
      if (failed) view.status("");
      failed = false;
    } catch (error) {
      if (mine !== reading) return;
      failed = true;
      view.status(`Could not read ${LABELS[section].toLowerCase()}: ${codeOf(error)}.`);
    } finally {
      if (mine === reading) busy = false;
    }
  };

  /** @param {Section} section */
  const show = async (section) => {
    if (!isSection(section)) return;
    current = section;
    table = null;
    state.set({ section });
    view.sections(LIST, current);
    stop();
    stop = every(RUNTIME.has(section) ? RUNTIME_EVERY_MS : EVERY_MS, () => {
      // A slow read (a large render tree) is not stacked up.
      if (!busy) void refresh();
    });
    await refresh();
  };

  /** @param {string} text */
  const filter = (text) => {
    query = text;
    draw();
  };

  /** The section in view, read now and whole (the filter is the page's, not the export's). */
  const exportJson = async () => {
    const section = current;
    try {
      view.exported(exported({ [section]: await fetchSection(section, sources) }));
    } catch (error) {
      view.status(`Could not export ${LABELS[section].toLowerCase()}: ${codeOf(error)}.`);
    }
  };

  bridge.onEvent((event) => {
    if (event.event === "plugin.changed" && current === "plugins") void refresh();
    else if (event.event === "perm.changed" && current === "grants") void refresh();
  });

  const ready = show(current);
  return { ready, show, filter, exportJson, refresh };
}
