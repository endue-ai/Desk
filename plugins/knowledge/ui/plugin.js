// The knowledge base's controller: whether desk.agent-sessions is connected, the session items
// read page by page and kept current through data.subscribe, the graph built from them, its
// layout, the filters and the selection, and the screen handed to the view after each change.

import { registerCommands } from "./commands.js";
import { buildGraph, repositories } from "./graph.js";
import { CONNECTOR, DEFAULTS, INSTANCE, KINDS, MANAGE, READ } from "./kinds.js";
import { createLayouts } from "./layout-client.js";
import { counts, panelFor, timeline } from "./model.js";
import { noteFor } from "./notes.js";
import { around, resolve, search, visible } from "./query.js";
import { layoutInput, positionsOf, sceneOf } from "./scene.js";

/**
 * @typedef {import("./graph.js").Graph} Graph
 * @typedef {import("./query.js").Filters} Filters
 * @typedef {"loading" | "off" | "reading" | "ready" | "error"} Status
 * @typedef {"graph" | "local" | "note"} Mode
 * @typedef {{ render(screen: any): void }} View
 * @typedef {{ startWorker?: any, layouts?: ReturnType<typeof createLayouts>,
 *   fail?: (id: string, code: string, message: string) => Error, settle?: number }} Options
 */

const PAGE = 500;
/** Items read at most: the index keeps 50 000 per source. */
const MAX_ITEMS = 50_000;
const QUERY = Object.freeze({ kinds: ["record"], sources: [CONNECTOR] });

/** Mount the controller on `ctx`, drawing through `view`. */
export function startPlugin(
  /** @type {any} */ ctx,
  /** @type {View} */ view,
  /** @type {Options} */ options = {},
) {
  const layouts = options.layouts ?? createLayouts(options.startWorker);
  const settle = options.settle ?? 800;
  /** @type {Map<string, any>} */
  const items = new Map();
  const state = {
    /** @type {Status} */ status: "loading",
    message: "",
    /** @type {Graph} */ graph: buildGraph([]),
    /** @type {Filters} */
    filters: {
      agents: { claude: true, codex: true, hermes: true },
      kinds: Object.fromEntries(Object.keys(KINDS).map((k) => [k, k !== "branch"])),
      subagents: true,
      orphans: false,
      shared: DEFAULTS.shared,
      repo: "",
    },
    settings: { ignore: DEFAULTS.ignore, hub: DEFAULTS.hub },
    /** @type {Mode} */ mode: "graph",
    /** @type {string | null} */ selected: null,
    query: "",
    /** @type {any} */ scene: undefined,
    fitKey: 0,
  };
  /** @type {Map<string, [number, number]>} */
  let positions = new Map();
  /** @type {Array<() => void>} */
  const offs = [];
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pending;

  const show = () => {
    const graph = state.graph;
    const scene = state.scene;
    const drawn = scene ? new Set(scene.ids) : new Set();
    const index = (/** @type {string | null} */ id) =>
      id && scene ? (scene.index.get(id) ?? -1) : -1;
    const only =
      state.mode === "local" && state.selected && scene && drawn.has(state.selected)
        ? new Set([...around(drawnOf(), state.selected, 2).nodes].map((id) => scene.index.get(id)))
        : undefined;
    const found = state.query ? search(graph, state.query, { limit: 200 }) : undefined;
    const marked = new Set(
      [...(found?.entities ?? []), ...(found?.sessions ?? [])]
        .map((x) => index(x.id))
        .filter((i) => i >= 0),
    );
    view.render({
      status: state.status,
      message: state.message,
      counts: counts(graph),
      repos: repositories(graph),
      filters: state.filters,
      mode: state.mode,
      query: state.query,
      scene,
      only,
      selected: index(state.selected),
      selectedId: state.selected,
      marked,
      panel: panelFor(graph, state.selected),
      note: state.mode === "note" && state.selected ? noteFor(graph, state.selected) : undefined,
      days: timeline(
        graph,
        new Set([...graph.sessions.keys()].filter((id) => drawn.has(id))),
        state.selected,
      ),
      fitKey: state.fitKey,
    });
  };

  const drawnOf = () => visible(state.graph, state.filters);

  /** Lay the drawn graph out again, seeded by where its nodes were. */
  const relayout = async (/** @type {boolean} */ refit) => {
    const drawn = drawnOf();
    const input = layoutInput(state.graph, drawn, positions);
    const placed = await layouts.run(input);
    if (!placed) return;
    state.scene = sceneOf(state.graph, drawn, input.ids, placed);
    positions = new Map([...positions, ...positionsOf(state.scene)]);
    if (refit) state.fitKey += 1;
    show();
  };

  const rebuild = async (/** @type {boolean} */ refit) => {
    state.graph = buildGraph(items.values(), state.settings);
    if (
      state.selected &&
      !state.graph.sessions.has(state.selected) &&
      !state.graph.entities.has(state.selected)
    )
      state.selected = null;
    if (state.status === "reading" && items.size) state.status = "ready";
    await relayout(refit);
  };

  const later = () => {
    clearTimeout(pending);
    pending = setTimeout(() => void rebuild(false), settle);
  };

  /** Read every session item, page by page. */
  const load = async () => {
    items.clear();
    /** @type {string | undefined} */
    let cursor;
    do {
      const page = await ctx.data.query(
        { ...QUERY, limit: PAGE, ...(cursor ? { cursor } : {}) },
        { scope: READ },
      );
      for (const item of page.items) items.set(item.id, item);
      cursor = page.cursor;
    } while (cursor && items.size < MAX_ITEMS);
  };

  /** The connector's state: off until the person connects it. */
  const connection = async () => {
    const listed = await ctx.bridge.call("connector.list", { scope: MANAGE });
    const connector = listed.connectors.find((/** @type {any} */ c) => c.id === CONNECTOR);
    if (!connector)
      return {
        status: /** @type {Status} */ ("error"),
        message: "This desk has no agent sessions connector.",
      };
    const instance = connector.instances.find((/** @type {any} */ i) => i.instance === INSTANCE);
    if (!instance) return { status: /** @type {Status} */ ("off"), message: "" };
    const { state: at, message } = instance.status;
    if (at === "error")
      return {
        status: /** @type {Status} */ ("error"),
        message: message ?? "The last sync failed.",
      };
    return { status: /** @type {Status} */ (at === "syncing" ? "reading" : "ready"), message: "" };
  };

  const refresh = async () => {
    try {
      const found = await connection();
      state.status = found.status;
      state.message = found.message;
      if (found.status === "off" || (found.status === "error" && !items.size)) return show();
      await load();
      if (!items.size) state.status = "reading";
      await rebuild(true);
    } catch (error) {
      state.status = "error";
      state.message = describe(error);
      show();
    }
  };

  const actions = {
    /** Connect desk.agent-sessions: the person's consent to read the transcripts. */
    async connect() {
      state.status = "reading";
      state.message = "";
      show();
      try {
        await ctx.bridge.call("connector.connect", { connector: CONNECTOR, scope: MANAGE });
      } catch (error) {
        if (describe(error).includes("already has an instance")) return refresh();
        state.status = "error";
        state.message = describe(error);
        show();
      }
    },
    async sync() {
      await ctx.bridge.call("connector.sync", {
        connector: CONNECTOR,
        instance: INSTANCE,
        scope: MANAGE,
      });
    },
    select(/** @type {string | null} */ id) {
      state.selected =
        id && (state.graph.sessions.has(id) || state.graph.entities.has(id)) ? id : null;
      if (!state.selected && state.mode !== "graph") state.mode = "graph";
      if (state.mode === "local") state.fitKey += 1;
      show();
    },
    /** Select what `name` refers to and show it with what lies around it. */
    focus(/** @type {string} */ name) {
      const id = resolve(state.graph, name);
      if (!id) return undefined;
      state.selected = id;
      state.mode = "local";
      state.fitKey += 1;
      show();
      return id;
    },
    mode(/** @type {Mode} */ mode) {
      state.mode = mode !== "graph" && !state.selected ? "graph" : mode;
      state.fitKey += 1;
      show();
    },
    search(/** @type {string} */ text) {
      state.query = text.trim();
      show();
    },
    /** Change one filter; a change of what is drawn lays the graph out again. */
    filter(/** @type {string} */ name, /** @type {any} */ value) {
      const f = state.filters;
      if (name.startsWith("agent:")) f.agents[name.slice(6)] = Boolean(value);
      else if (name.startsWith("kind:")) f.kinds[name.slice(5)] = Boolean(value);
      else if (name === "subagents" || name === "orphans") f[name] = Boolean(value);
      else if (name === "repo") f.repo = String(value ?? "");
      else if (name === "shared") f.shared = Math.max(1, Number(value) || 1);
      void relayout(true);
    },
    graph: () => state.graph,
    status: () => state.status,
    /** Filled in by the commands: write every note, write and open one. */
    writeNotes: async () => ({ folder: "", written: 0 }),
    openNote: async (/** @type {string} */ _id) => {},
  };

  const start = async () => {
    for (const key of /** @type {const} */ (["ignore", "hub", "shared"])) {
      const value = await ctx.settings.get(key).catch(() => undefined);
      if (value === undefined) continue;
      if (key === "shared") state.filters.shared = Number(value);
      else state.settings[key] = value;
    }
    offs.push(
      ctx.settings.onChange((/** @type {any} */ setting) => {
        const key = String(setting.key).split(".").at(-1);
        if (key === "shared") return actions.filter("shared", setting.value);
        if (key === "ignore" || key === "hub") {
          state.settings[key] = setting.value ?? DEFAULTS[key];
          void rebuild(true);
        }
      }),
    );
    offs.push(
      ctx.bridge.onEvent((/** @type {any} */ event) => {
        if (event.event === "connector.changed" && event.data?.connector === CONNECTOR)
          void refresh();
      }),
    );
    Object.assign(actions, registerCommands(ctx, actions, options.fail));
    show();
    try {
      offs.push(
        await ctx.data.subscribe(
          QUERY,
          (/** @type {any[]} */ changes) => {
            for (const change of changes) {
              if (change.change === "upserted") items.set(change.item.id, change.item);
              else items.delete(change.id);
            }
            later();
          },
          { scope: READ },
        ),
      );
    } catch (error) {
      state.message = describe(error);
    }
    await refresh();
  };

  return {
    start,
    actions,
    stop() {
      clearTimeout(pending);
      for (const off of offs.splice(0)) off();
      layouts.stop();
    },
  };
}

/** What went wrong, in the words the error carries. */
export function describe(/** @type {unknown} */ error) {
  return error instanceof Error ? error.message : String(error);
}
