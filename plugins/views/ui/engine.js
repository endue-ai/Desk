// desk.views without its DOM. It opens a view by id (view.get), binds its requires to connected
// instances (connector.list, asking desk.palette.pick when several match), queries and subscribes
// every binding (data.query, data.subscribe), re-queries a component when data.changed names it,
// follows its sources' status (connector.changed) and the view file (view.changed), and answers its
// commands. It talks only to ctx and to a screen, so the SDK's test host runs it with a recording one.

import { build, queryOf, scopeOf, settle } from "./components.js";
import { keyOf } from "./present.js";
import { choose } from "./resolve.js";
import { fill, fillValue } from "./template.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").ConnectorInfo} ConnectorInfo
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").View} View
 * @typedef {import("./components.js").ComponentModel} ComponentModel
 * @typedef {import("./components.js").NodeModel} NodeModel
 * @typedef {import("./components.js").Live} Live
 * @typedef {import("./resolve.js").Bound} Bound
 * @typedef {import("./template.js").Env} Env
 * @typedef {{ id: string, title: string, description: string, root: NodeModel, env: Env }} ViewModel
 * @typedef {{ draw(model: ViewModel | null): void, update(component: ComponentModel, env: Env): void,
 *   notice(text: string): void, toast(text: string): void }} Screen
 * @typedef {{ now?: () => number, zone?: string, locale?: string }} EngineOptions
 * @typedef {{ label: string, action?: number, original?: string }} MenuEntry
 * @typedef {ReturnType<typeof createEngine>} Engine
 */

const CONNECTORS = /** @type {const} */ ({ permission: "connector:manage" });
const ORIGINAL = "Desk can't open the original app yet";
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;
const said = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {PluginContext} ctx
 * @param {Screen} screen
 * @param {EngineOptions} [options]
 */
export function createEngine(ctx, screen, options = {}) {
  const clock = options.now ?? (() => Date.now());
  const zone = options.zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const locale = options.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  /** @type {ConnectorInfo[]} */
  let connectors = [];
  /** The view on screen, or null. @type {{ id: string, view: View, given: Record<string, unknown>,
   *   params: Record<string, unknown>, bound: Record<string, Bound>, live: Map<string, Live>,
   *   model: ViewModel } | null} */
  let current = null;
  let opens = 0;

  /** @returns {Env} */
  const envOf = (/** @type {Record<string, unknown>} */ params) => ({
    zone: typeof params.timeZone === "string" ? params.timeZone : zone,
    locale,
    now: clock(),
    params,
  });
  const ago = (/** @type {number} */ ms) =>
    fill("{at|relative}", { at: new Date(clock() + ms).toISOString() }, envOf({}));

  /** The declared params: what open was given, else each one's default. */
  const paramsOf = (/** @type {View} */ view, /** @type {Record<string, unknown>} */ given) =>
    Object.fromEntries(
      Object.entries(view.params ?? {}).map(([name, param]) => [
        name,
        given[name] ?? param.default,
      ]),
    );

  const show = (/** @type {Live} */ entry) => {
    if (!current || current.live.get(entry.model.path) !== entry) return;
    settle(entry, connectors, envOf(current.params), ago);
    screen.update(entry.model, envOf(current.params));
  };

  /** Ask a component's query again; its items stay on screen until the answer. */
  const refresh = async (/** @type {Live} */ entry) => {
    if (!entry.binding || !current) return;
    const asked = ++entry.asked;
    const query = queryOf(entry, envOf(current.params));
    try {
      const page = await ctx.data.query(query);
      if (asked !== entry.asked) return;
      entry.model.items = page.items;
      entry.model.more = page.cursor !== undefined;
      entry.failed = undefined;
      entry.refused = undefined;
    } catch (error) {
      if (asked !== entry.asked) return;
      const permission = /** @type {{ permission?: unknown }} */ (error).permission;
      if (codeOf(error) === "permission_denied")
        entry.refused = /** @type {Live["refused"]} */ (permission ?? scopeOf(query));
      else entry.failed = `The items could not be read: ${said(error)}`;
    }
    entry.answered = true;
    show(entry);
  };

  const subscribe = async (/** @type {Live} */ entry) => {
    if (!entry.binding || !current) return;
    const query = queryOf(entry, envOf(current.params));
    entry.unsubscribe = await ctx.data
      .subscribe(query, () => void refresh(entry))
      .catch(() => undefined);
    // Opened something else meanwhile: this subscription is already of no use.
    if (!current || current.live.get(entry.model.path) !== entry) entry.unsubscribe?.();
  };

  /** End every subscription of the view on screen and forget it. */
  const end = () => {
    for (const entry of current?.live.values() ?? []) {
      entry.unsubscribe?.();
      entry.binding = undefined;
    }
    current = null;
  };

  /** Ask the person which instance a require binds to; undefined when they cancel. */
  const pick = async (
    /** @type {string} */ name,
    /** @type {import("@endue-ai/bridge").ConnectorInstance[]} */ found,
    /** @type {View} */ view,
  ) => {
    const items = found.map((i) => ({
      id: `${i.connector}/${i.instance}`,
      label: i.title ?? i.instance,
      detail: `${i.connector} · ${i.status.state}`,
    }));
    const title = view.requires?.[name]?.title ?? `Pick a source for ${name}`;
    const id = await ctx.commands.run("desk.palette.pick", { title, items }).catch(() => undefined);
    const chosen = found.find((i) => `${i.connector}/${i.instance}` === id);
    return chosen && { connector: chosen.connector, instance: chosen.instance };
  };

  /**
   * desk.views.open { id, params?, bindings? }: read, bind, draw, query and subscribe, then show.
   * @param {unknown} args
   */
  const open = async (args) => {
    const {
      id,
      params = {},
      bindings = {},
    } = /** @type {{ id?: unknown, params?: Record<string,
     *  unknown>, bindings?: Record<string, import("./resolve.js").Binding> }} */ (args ?? {});
    if (typeof id !== "string") throw new Error("desk.views.open needs the id of a view.");
    const turn = ++opens;
    const view = await ctx.views.get(id).catch((error) => {
      throw new Error(`There is no view ${id}: ${said(error)}`);
    });
    const listed = await ctx.bridge.call("connector.list", { scope: CONNECTORS }).catch(() => null);
    const choice = choose(view, listed?.connectors ?? [], bindings);
    for (const [name, found] of Object.entries(choice.pick)) {
      const chosen = await pick(name, found, view);
      if (chosen) choice.bound[name] = chosen;
    }
    if (turn !== opens) return { id, replaced: true };
    end();
    connectors = listed?.connectors ?? [];
    const given = params;
    const resolved = paramsOf(view, given);
    const env = envOf(resolved);
    const { root, live } = build(view.layout, choice.bound, env);
    const title = fill(view.title, {}, env);
    // A view that is one component names it by the view's title.
    if (root.kind === "component" && !root.title) root.label = title;
    const model = {
      id,
      title,
      description: view.description ?? "",
      root,
      env,
    };
    current = { id, view, given, params: resolved, bound: choice.bound, live, model };
    for (const entry of live.values()) settle(entry, connectors, env, ago);
    screen.draw(model);
    // Each binding's query and subscription leave together, in layout order.
    await Promise.all([...live.values()].flatMap((entry) => [refresh(entry), subscribe(entry)]));
    if (turn !== opens) return { id, replaced: true };
    ctx.surface.show();
    return { id, title: model.title };
  };

  const close = () => {
    end();
    screen.draw(null);
    ctx.surface.hide();
  };

  /** The live component at a path, and one of its items by key. */
  const at = (/** @type {string} */ path, /** @type {string} [key] */ key) => {
    const entry = current?.live.get(path);
    const item = key === undefined ? undefined : entry?.model.items.find((i) => keyOf(i) === key);
    return { entry, item };
  };

  /** Run a command; a failure is said in a toast. */
  const run = async (
    /** @type {string} */ id,
    /** @type {Record<string, unknown>} */ args,
    /** @type {string} */ failed,
  ) => {
    try {
      return await ctx.commands.run(id, args);
    } catch (error) {
      screen.toast(failed || said(error));
      return undefined;
    }
  };

  const openOriginal = (/** @type {string} */ url) =>
    run("desk.views.open-original", { url }, ORIGINAL);

  /** Run one of a component's actions on an item, its args filled from the item. */
  const act = async (
    /** @type {string} */ path,
    /** @type {number} */ index,
    /** @type {string} */ key,
  ) => {
    const { entry, item } = at(path, key);
    const action = entry?.model.node.actions?.[index];
    if (!entry || !item || !action || !current) return;
    const args = fillValue(
      action.args ?? { source: "{source}", id: "{id}" },
      item,
      envOf(current.params),
    );
    const shown = action.title ?? action.command;
    const named = /** @type {Record<string, unknown>} */ (
      args && typeof args === "object" ? args : { value: args }
    );
    await run(action.command, named, `${shown} did not work.`);
  };

  ctx.commands.on("desk.views.open", open);
  ctx.commands.on("desk.views.close", () => close());
  ctx.commands.on("desk.views.reconnect", async (args) => {
    const { connector, instance } = /** @type {{ connector?: string, instance?: string }} */ (
      args ?? {}
    );
    if (!connector || !instance)
      throw new Error("desk.views.reconnect needs a connector and an instance.");
    return ctx.bridge.call("connector.sync", { connector, instance, scope: CONNECTORS });
  });
  ctx.commands.on("desk.views.request-access", async (args) => {
    const { kinds, sources } = /** @type {{ kinds?: string[], sources?: string[] }} */ (args ?? {});
    const permission = /** @type {import("@endue-ai/bridge").DataReadPermission} */ ({
      permission: "data:read",
      ...(kinds ? { kinds } : {}),
      ...(sources ? { sources } : {}),
    });
    const title = current?.model.title ?? "this view";
    const { granted } = await ctx.perm.request(permission, `To show its items in ${title}`);
    if (granted)
      await Promise.all([...(current?.live.values() ?? [])].filter((e) => e.refused).map(refresh));
    return { granted };
  });
  ctx.commands.on("desk.views.open-original", () => {
    throw new Error("shell.open is not served yet");
  });

  ctx.bridge.onEvent((/** @type {BridgeEvent} */ event) => {
    if (event.event === "connector.changed") {
      const { connector, instance, change, status } = event.data;
      const owner = connectors.find((c) => c.id === connector);
      const found = owner?.instances.find((i) => i.instance === instance);
      if (found && status) found.status = status;
      else if (owner && change === "disconnected")
        owner.instances = owner.instances.filter((i) => i !== found);
      for (const entry of current?.live.values() ?? []) show(entry);
    } else if (event.event === "view.changed" && event.data.id === current?.id) {
      const { given, bound, model } = current;
      if (event.data.change === "saved")
        void open({ id: current.id, params: given, bindings: bound }).catch(() => {});
      else {
        end();
        screen.draw(null);
        screen.notice(`${model.title} was removed.`);
      }
    }
  });

  return {
    open,
    close,
    /** Reconnect the source a component reads (the Reconnect button). */
    reconnect: async (/** @type {string} */ path) => {
      const instance = at(path).entry?.model.instance;
      if (instance) await run("desk.views.reconnect", { ...instance }, "");
    },
    /** Ask for the data:read a refused component needs (the Ask for access button). */
    requestAccess: async (/** @type {string} */ path) => {
      const scope = at(path).entry?.model.scope;
      if (!scope) return;
      const args = {
        ...(scope.kinds ? { kinds: scope.kinds } : {}),
        ...(scope.sources ? { sources: scope.sources } : {}),
      };
      await run("desk.views.request-access", args, "");
    },
    /** Lead to the connectors view for an unbound component (the Connect a source button). */
    connect: async (/** @type {string} */ path) => {
      const { entry } = at(path);
      if (!entry || !current) return;
      try {
        await ctx.commands.run("desk.connectors.open", { kinds: entry.model.kinds ?? [] });
      } catch (error) {
        entry.model.message =
          codeOf(error) === "unknown_command" ? "Connecting a source comes later." : said(error);
        screen.update(entry.model, envOf(current.params));
      }
    },
    /** Enter on an item: its component's first action, or the original app when it has none. */
    activate: async (/** @type {string} */ path, /** @type {string} */ key) => {
      const { entry, item } = at(path, key);
      if (!entry || !item) return;
      if (entry.model.node.actions?.length) await act(path, 0, key);
      else if (item.deepLink) await openOriginal(item.deepLink);
    },
    /** The action menu for an item: the component's actions in order, then the original app. */
    menu: (/** @type {string} */ path, /** @type {string} */ key) => {
      const { entry, item } = at(path, key);
      if (!entry || !item) return [];
      /** @type {MenuEntry[]} */
      const entries = (entry.model.node.actions ?? []).map((a, i) => ({
        label: a.title ?? a.command,
        action: i,
      }));
      if (item.deepLink)
        entries.push({ label: "Open in the original app", original: item.deepLink });
      return entries;
    },
    /** Run what a menu entry names. */
    choose: async (
      /** @type {string} */ path,
      /** @type {string} */ key,
      /** @type {MenuEntry} */ entry,
    ) => {
      if (entry.original !== undefined) await openOriginal(entry.original);
      else if (entry.action !== undefined) await act(path, entry.action, key);
    },
    /** A link in a markdown component: the original app, once shell.open is served. */
    link: (/** @type {string} */ href) => openOriginal(href),
  };
}
