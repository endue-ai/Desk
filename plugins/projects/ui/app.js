// The projects plugin without its DOM: every task item the index holds, through the adapters, as one
// set of work; the view that shows it and how; the flow between them. Tasks come from the desk's
// index (actions.js: data.query with one ask on a refusal, data.subscribe for changes); moving or
// rescheduling one runs its connector's command, shown at once and undone when the connector
// refuses. It talks only to ctx.bridge, ctx.commands, ctx.settings, ctx.surface and a view, so the
// SDK's test host runs it.

import { createActions } from "./actions.js";
import { workOf } from "./adapters/index.js";
import { registerCommands } from "./commands.js";
import { createEditing } from "./editing.js";
import { stepMonth } from "./layout/calendar.js";
import { dayOf, todayOf, WEEK_STARTS } from "./layout/dates.js";
import { step } from "./layout/timeline.js";
import { sourceTitle } from "./model.js";
import { screenOf } from "./present.js";
import {
  asString,
  columnsFrom,
  DEFAULTS,
  initialState,
  isGroup,
  isView,
  isZoom,
  MAX_WORK,
  PAGE,
  restore,
  saved,
} from "./state.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {import("./present.js").Screen} Screen
 * @typedef {{ render(screen: Screen): void, status(text: string): void, focus(where: "body" | "detail" | "search"): void }} View
 */

const VIEW_KEY = "view";

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "settings" | "surface">} ctx
 * @param {View} view
 * @param {{ now?: () => number }} [options]
 */
export function createProjects({ bridge, commands, settings, surface }, view, options = {}) {
  const now = options.now ?? (() => Date.now());
  const s = initialState(dayOf(todayOf(now())));
  const actions = createActions({ bridge, commands });
  /** @type {Screen} */
  let screen = screenOf(s);
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const fail = (/** @type {unknown} */ error) =>
    say(error instanceof Error ? error.message : String(error));
  const save = () => bridge.call("store.set", { key: VIEW_KEY, value: saved(s) }).catch(() => {});
  const draw = () => {
    s.today = dayOf(todayOf(now()));
    screen = screenOf(s);
    if (s.selected !== null && screen.selected === null) s.selected = null;
    view.render(screen);
  };

  /** Replace or add one piece of work, or take it out (`null`), by key. */
  const put = (/** @type {string} */ key, /** @type {Work | null} */ work) => {
    const rest = s.works.filter((w) => w.key !== key);
    s.works = work ? [...rest, work] : rest;
    if (!work && s.open === key) s.open = null;
  };
  const taskWork = (/** @type {Item[]} */ items) =>
    items.filter((i) => i.kind === "task").map((i) => workOf(/** @type {TaskItem} */ (i)));

  /** Every task the index holds, page by page, up to MAX_WORK. */
  const load = async () => {
    s.loading = true;
    draw();
    try {
      /** @type {Item[]} */
      const items = [];
      /** @type {string | undefined} */
      let cursor;
      do {
        const page = await actions.query({
          kinds: ["task"],
          limit: PAGE,
          ...(cursor ? { cursor } : {}),
        });
        items.push(...page.items);
        cursor = page.cursor;
      } while (cursor && items.length < MAX_WORK);
      s.works = taskWork(items.slice(0, MAX_WORK));
      s.truncated = Boolean(cursor) || items.length > MAX_WORK;
      say(s.truncated ? `Showing the first ${MAX_WORK} tasks.` : "");
    } catch (error) {
      fail(error);
    } finally {
      s.loading = false;
      s.loaded = true;
      draw();
    }
  };

  /** The connected sources, the installed task connectors and what the connectors let it do. */
  const meta = async () => {
    const [sources, available, installed] = await Promise.all([
      actions.sources(),
      actions.available(),
      actions.installed(),
    ]);
    s.installed = installed;
    s.sources = sources
      .map((src) => {
        const key = `${src.connector}/${src.instance}`;
        const known = s.works.find((w) => `${w.source.connector}/${w.source.instance}` === key);
        return { key, title: known ? sourceTitle(known) : key };
      })
      .sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
    s.available = available;
    if (s.filter.source !== null && !s.sources.some((x) => x.key === s.filter.source))
      s.filter.source = null;
  };

  /** Follow the index: new tasks join, changed ones move, removed ones leave. */
  const follow = async () => {
    bridge.onEvent((event) => {
      if (event.event !== "data.changed") return;
      for (const c of event.data.changes) {
        if (c.change === "removed") put(`${c.source.connector}/${c.source.instance}#${c.id}`, null);
        else if (c.item.kind === "task") {
          const work = workOf(c.item);
          put(work.key, work);
        }
      }
      draw();
    });
    await actions.subscribe().catch(() => undefined);
  };

  const refresh = async () => {
    await load();
    await meta().catch(() => {});
    draw();
    return s.works.length;
  };

  /** The work a command names (`{ source, id }`, from an agent), or the open, or the selected one. */
  const named = async (/** @type {Record<string, unknown>} */ a) => {
    const source = /** @type {{ connector?: unknown, instance?: unknown }} */ (a.source ?? {});
    const id = asString(a.id);
    if (id && typeof source.connector === "string" && typeof source.instance === "string") {
      const key = `${source.connector}/${source.instance}#${id}`;
      const here = s.works.find((w) => w.key === key);
      if (here) return here;
      const item = await actions.get(
        { connector: source.connector, instance: source.instance },
        id,
      );
      if (item?.kind !== "task") throw new Error(`There is no task ${id}.`);
      const work = workOf(item);
      put(work.key, work);
      return work;
    }
    const key = s.open ?? s.selected;
    const work = s.works.find((w) => w.key === key);
    if (!work) throw new Error("Select a task first.");
    return work;
  };

  const editing = createEditing({
    actions,
    state: s,
    screen: () => screen,
    put,
    draw,
    say,
    fail,
  });

  /** Show one piece of work's details. */
  const open = (/** @type {string | null} */ key) => {
    s.open = key;
    if (key !== null) s.selected = key;
    draw();
    view.focus(key === null ? "body" : "detail");
    return key;
  };
  const select = (/** @type {string | null} */ key) => {
    s.selected = key;
    draw();
  };
  /** A key pressed on the body; resolves whether the plugin used it. */
  const key = async (/** @type {string} */ name) => {
    const order = screen.order;
    if (name === "Enter") {
      if (s.selected !== null) open(s.selected);
      return s.selected !== null;
    }
    if (name === "Escape") {
      if (s.open === null) return false;
      open(null);
      return true;
    }
    if (name === "Shift+ArrowRight" || name === "Shift+ArrowLeft") {
      await editing.shift(name === "Shift+ArrowRight" ? 1 : -1).catch(() => {});
      return true;
    }
    const at = s.selected === null ? -1 : order.indexOf(s.selected);
    const next =
      name === "ArrowDown" || name === "j" || name === "ArrowRight"
        ? Math.min(at + 1, order.length - 1)
        : name === "ArrowUp" || name === "k" || name === "ArrowLeft"
          ? Math.max(at - 1, 0)
          : name === "Home"
            ? 0
            : name === "End"
              ? order.length - 1
              : undefined;
    if (next === undefined || order.length === 0) return false;
    select(order[next] ?? null);
    return true;
  };

  const setView = (/** @type {unknown} */ name) => {
    if (!isView(name))
      throw new Error(
        `${String(name)} is not a view: kanban, swimlane, list, table, timeline or calendar.`,
      );
    s.view = /** @type {typeof s.view} */ (name);
    void save();
    draw();
    return s.view;
  };
  const setGroup = (/** @type {unknown} */ by) => {
    if (!isGroup(by)) throw new Error(`Cannot group by ${String(by)}.`);
    s.group = /** @type {string} */ (by);
    void save();
    draw();
    return s.group;
  };
  const setSearch = (/** @type {string} */ text) => {
    s.filter.text = text.trim();
    draw();
    return s.filter.text;
  };
  const setSource = (/** @type {string | null} */ source) => {
    if (source !== null && !s.sources.some((x) => x.key === source))
      throw new Error(`${source} is not a connected source.`);
    s.filter.source = source;
    void save();
    draw();
    return source;
  };
  const setShowDone = (/** @type {boolean} */ on) => {
    s.filter.showDone = on;
    void save();
    draw();
    return on;
  };
  const setZoom = (/** @type {unknown} */ zoom) => {
    if (!isZoom(zoom)) throw new Error(`${String(zoom)} is not a zoom: week, month or quarter.`);
    s.zoom = /** @type {typeof s.zoom} */ (zoom);
    void save();
    draw();
    return s.zoom;
  };
  /** Move the timeline or calendar to today, or a period back or ahead. */
  const go = (/** @type {string} */ to) => {
    if (to === "today") s.anchor = s.today;
    else if (to === "next" || to === "previous") {
      const dir = to === "next" ? 1 : -1;
      s.anchor = s.view === "calendar" ? stepMonth(s.anchor, dir) : step(s.anchor, s.zoom, dir);
    } else throw new Error(`Go where? today, next or previous, not ${to}.`);
    draw();
    return screen.period;
  };
  /** Sort by a field; again on the same field turns the order around, a third time clears it. */
  const sortBy = (/** @type {string} */ field) => {
    if (s.sort?.field !== field) s.sort = { field, dir: "asc" };
    else if (s.sort.dir === "asc") s.sort = { field, dir: "desc" };
    else s.sort = null;
    void save();
    draw();
    return s.sort;
  };

  const { command } = registerCommands({
    commands,
    surface,
    view,
    say,
    app: {
      screen: () => screen,
      open,
      named,
      refresh,
      setView,
      setGroup,
      setSearch,
      setSource,
      setShowDone: (on) => setShowDone(on ?? !s.filter.showDone),
      setZoom,
      go,
      pick: actions.pick,
      connect: actions.connect,
      openLink: actions.openLink,
      move: editing.move,
      update: editing.update,
    },
  });

  settings.onChange(({ key: name, value }) => {
    if (name === "week-start" && typeof value === "string")
      s.weekStart = WEEK_STARTS[value] ?? s.weekStart;
    else if (name === "columns") s.columns = columnsFrom(value);
    else return;
    draw();
  });

  /** Read the settings and the saved state, load the work, and follow the index. */
  const start = async () => {
    const init = await bridge.call("init.get", {}).catch(() => ({ settings: {} }));
    const setting = async (/** @type {keyof typeof DEFAULTS} */ name) =>
      (await settings.get(name).catch(() => undefined)) ??
      /** @type {Record<string, unknown> | undefined} */ (init.settings)?.[
        `endue.projects.${name}`
      ] ??
      DEFAULTS[name];
    const first = await setting("view");
    if (isView(first)) s.view = /** @type {typeof s.view} */ (first);
    s.weekStart = WEEK_STARTS[String(await setting("week-start"))] ?? 1;
    s.filter.showDone = (await setting("show-done")) !== false;
    s.columns = columnsFrom(await setting("columns"));
    const kept = await bridge.call("store.get", { key: VIEW_KEY }).catch(() => ({}));
    restore(s, /** @type {{ value?: unknown }} */ (kept).value);
    draw();
    await Promise.all([load(), follow()]);
    await meta().catch(() => {});
    draw();
  };

  return {
    start,
    select,
    open,
    key,
    command,
    setView,
    setGroup,
    setSearch,
    setSource,
    setShowDone,
    setZoom,
    go,
    sortBy,
    refresh,
    drop: editing.drop,
    connect: () => actions.connect().catch(fail),
    openLink: (/** @type {string} */ url) => actions.openLink(url).catch(fail),
    /** The work as the plugin holds it, for tests. */
    works: () => s.works,
    screen: () => screen,
  };
}
