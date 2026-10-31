/**
 * The integration layer for the browser stub (ADR 0032), so views, plugins and tests run without the
 * core: an in-memory index of items (data.*), the installed connectors and their instances
 * (connector.*), the person's views (view.*; the stub has no view plugins, so every view it keeps
 * is source file) and catalog.get. It starts with the fixture connector `desk.fixtures` and its
 * items (fixtures.ts); `upsert` and `remove` change the index as a sync would, and subscribers hear
 * it as data.changed.
 */
import { StubError, type StubHandlers } from "./adapters";
import {
  FIXTURE_CONNECTOR,
  type FixtureConnector,
  fixtureConnector,
  fixtureItems,
} from "./fixtures";
import type {
  BridgeEvent,
  CallerId,
  CatalogConnector,
  CommandInfo,
  ConnectorChange,
  ConnectorInstance,
  DataReadPermission,
  Item,
  ItemChange,
  ItemQuery,
  ItemSource,
  Permission,
  View,
  ViewSummary,
} from "./generated";
import { starMatch } from "./stub-covers";
import { checkSources, fieldsOf, matches, page } from "./stub-query";
import { COMPONENTS, viewProblems } from "./stub-views";

/** The methods this part of the stub serves. */
export type DataServed =
  | `data.${"query" | "get" | "subscribe" | "unsubscribe"}`
  | `connector.${"list" | "connect" | "disconnect" | "sync"}`
  | `view.${"list" | "get" | "save" | "remove"}`
  | "catalog.get";

/** What the rest of the stub lends this part: its grants, events, ids, clock and commands. */
export interface DataContext {
  /** Refuse with permission_denied unless the caller holds a grant covering `scope`. */
  check(caller: string | undefined, scope: Permission): void;
  /** Whether the caller holds a grant covering `permission`; the runtime holds every one. */
  may(caller: string | undefined, permission: Permission): boolean;
  /** The plugin callers holding a grant that covers `permission`. */
  holders(permission: Permission): string[];
  later(event: BridgeEvent): void;
  fresh(prefix: string): string;
  me(caller: string | undefined): CallerId;
  now(): string;
  commands(): CommandInfo[];
}

export interface StubData {
  handlers: Required<Pick<StubHandlers, DataServed>>;
  /** Add an item to the index or replace the one with its source and id. */
  upsert(item: Item): void;
  /** Take an item out of the index; false when it was not there. */
  remove(source: ItemSource, id: string): boolean;
  /** Who hears data.changed, connector.changed and view.changed; nobody else's events. */
  audience(event: BridgeEvent): string[];
  /** End the caller's data subscriptions, or only those `keep` says no. */
  drop(caller: string, keep?: (scope: DataReadPermission) => boolean): void;
}

const CONNECTORS: Permission = { permission: "connector:manage" };
const VIEWS: Permission = { permission: "view:manage" };
const keyOf = (source: ItemSource, id: string) => `${source.connector}/${source.instance}/${id}`;
const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Whether a data:read scope covers an item: its kind, and its connector by pattern. */
const covered = (scope: DataReadPermission, item: Item) =>
  (scope.kinds?.includes(item.kind) ?? true) &&
  (scope.sources?.some((pattern) => starMatch(pattern, item.source.connector)) ?? true);

export function stubData(ctx: DataContext): StubData {
  const items = new Map(fixtureItems().map((item) => [keyOf(item.source, item.id), item]));
  const connectors = new Map<string, FixtureConnector>([[FIXTURE_CONNECTOR, fixtureConnector()]]);
  type Subscription = { caller: string; scope: DataReadPermission; query: ItemQuery };
  const subscriptions = new Map<string, Subscription>();
  const views = new Map<string, View>();
  const missing = (what: string) => new StubError("not_found", `${what} does not exist`);
  const invalid = (why: string) => new StubError("invalid_params", why);

  /** Tell each subscription about one item before and after a change: it arrives, or it leaves. */
  const announce = (before: Item | undefined, after: Item | undefined) => {
    for (const [subscriptionId, { scope, query }] of subscriptions) {
      const sees = (item: Item | undefined): item is Item =>
        item !== undefined && covered(scope, item) && matches(item, query);
      let change: ItemChange;
      if (sees(after)) change = { change: "upserted", item: structuredClone(after) };
      else if (sees(before)) change = { change: "removed", source: before.source, id: before.id };
      else continue;
      const data = { subscriptionId, changes: [structuredClone(change)] };
      ctx.later({ event: "data.changed", data });
    }
  };
  const upsert = (item: Item) => {
    const key = keyOf(item.source, item.id);
    const before = items.get(key);
    items.set(key, structuredClone(item));
    announce(before, item);
  };
  const remove = (source: ItemSource, id: string) => {
    const before = items.get(keyOf(source, id));
    if (!before) return false;
    items.delete(keyOf(source, id));
    announce(before, undefined);
    return true;
  };

  const installed = () => [...connectors.values()].sort(byId);
  const instanceOf = (connector: string, instance: string) => {
    const found = connectors.get(connector)?.instances.find((i) => i.instance === instance);
    if (!found) throw missing(`an instance ${instance} of ${connector}`);
    return found;
  };
  const changed = ({ connector, instance, status }: ConnectorInstance, change: ConnectorChange) => {
    const after = change === "disconnected" ? {} : { status: structuredClone(status) };
    ctx.later({ event: "connector.changed", data: { connector, instance, change, ...after } });
  };
  /** The settings an instance keeps and lists: declared, of their kind, required ones given,
   * secret ones left out (the core keeps them in the OS keychain). */
  const settingsOf = (connector: FixtureConnector, given: Record<string, unknown> = {}) => {
    const kept: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(given)) {
      const setting = connector.instanceSettings[name];
      if (!setting) throw invalid(`${connector.id} has no instance setting ${name}`);
      const integer = setting.kind === "integer";
      const kind = integer ? Number.isInteger(value) : typeof value === setting.kind;
      if (!kind) throw invalid(`${name} is a ${setting.kind}`);
      if (!setting.secret) kept[name] = value;
    }
    for (const [name, setting] of Object.entries(connector.instanceSettings))
      if (setting.required && !(name in given)) throw invalid(`${connector.id} needs ${name}`);
    return kept;
  };
  const summary = ({ id, version, title, description }: View): ViewSummary => ({
    id,
    version,
    title,
    ...(description === undefined ? {} : { description }),
    source: "file",
  });

  return {
    upsert,
    remove,
    audience: (event) => {
      if (event.event === "data.changed") {
        const subscription = subscriptions.get(event.data.subscriptionId);
        return subscription ? [subscription.caller] : [];
      }
      if (event.event === "connector.changed") return ctx.holders(CONNECTORS);
      if (event.event === "view.changed") return ctx.holders(VIEWS);
      return [];
    },
    drop: (caller, keep = () => false) => {
      for (const [id, s] of subscriptions)
        if (s.caller === caller && !keep(s.scope)) subscriptions.delete(id);
    },
    handlers: {
      "data.query": ({ query, scope }, caller) => {
        ctx.check(caller, scope);
        return page(
          [...items.values()].filter((item) => covered(scope, item)),
          query,
        );
      },
      "data.get": ({ source, id, scope }, caller) => {
        ctx.check(caller, scope);
        const item = items.get(keyOf(source, id));
        return item && covered(scope, item) ? { item: structuredClone(item) } : {};
      },
      "data.subscribe": ({ query, scope }, caller) => {
        ctx.check(caller, scope);
        checkSources(query);
        const subscriptionId = ctx.fresh("dsub");
        const subscription = { caller: ctx.me(caller), scope, query };
        subscriptions.set(subscriptionId, structuredClone(subscription));
        return { subscriptionId };
      },
      "data.unsubscribe": ({ subscriptionId }, caller) => {
        if (subscriptions.get(subscriptionId)?.caller !== ctx.me(caller))
          throw missing(`${ctx.me(caller)}'s data subscription ${subscriptionId}`);
        subscriptions.delete(subscriptionId);
        return {};
      },
      "connector.list": ({ scope }, caller) => {
        ctx.check(caller, scope);
        const list = installed().map(({ id, instances, resources }) => ({
          id,
          instances,
          resources,
        }));
        return { connectors: structuredClone(list) };
      },
      "connector.connect": (params, caller) => {
        const { connector: id, instance = "default", title, settings, scope } = params;
        ctx.check(caller, scope);
        const connector = connectors.get(id);
        if (!connector) throw missing(`a connector ${id}`);
        if (connector.instances.some((i) => i.instance === instance))
          throw new StubError("already_exists", `${id} already has an instance ${instance}`);
        const added: ConnectorInstance = {
          connector: id,
          instance,
          ...(title === undefined ? {} : { title }),
          settings: settingsOf(connector, settings),
          status: { state: "connected" },
        };
        connector.instances.push(added);
        changed(added, "connected");
        return { instance };
      },
      "connector.disconnect": ({ connector, instance, scope }, caller) => {
        ctx.check(caller, scope);
        const gone = instanceOf(connector, instance);
        const owner = connectors.get(connector) as FixtureConnector;
        owner.instances = owner.instances.filter((i) => i !== gone);
        for (const item of [...items.values()])
          if (item.source.connector === connector && item.source.instance === instance)
            remove(item.source, item.id);
        changed(gone, "disconnected");
        return {};
      },
      "connector.sync": ({ connector, instance, scope }, caller) => {
        ctx.check(caller, scope);
        const synced = instanceOf(connector, instance);
        const last = synced.status.lastSyncAt;
        synced.status = { state: "syncing", ...(last === undefined ? {} : { lastSyncAt: last }) };
        changed(synced, "updated");
        synced.status = { state: "connected", lastSyncAt: ctx.now() };
        changed(synced, "updated");
        return { started: true };
      },
      "view.list": ({ scope }, caller) => {
        ctx.check(caller, scope);
        return { views: structuredClone([...views.values()].sort(byId).map(summary)) };
      },
      "view.get": ({ id, scope }, caller) => {
        ctx.check(caller, scope);
        const view = views.get(id);
        if (!view) throw missing(`a view ${id}`);
        return { view: structuredClone(view), source: "file" };
      },
      "view.save": ({ view, scope }, caller) => {
        ctx.check(caller, scope);
        const problems = viewProblems(view);
        if (problems.length > 0) throw invalid(`the view is not valid: ${problems.join("; ")}`);
        views.set(view.id, structuredClone(view));
        ctx.later({ event: "view.changed", data: { id: view.id, change: "saved" } });
        return {};
      },
      "view.remove": ({ id, scope }, caller) => {
        ctx.check(caller, scope);
        if (!views.delete(id)) throw missing(`a view ${id}`);
        ctx.later({ event: "view.changed", data: { id, change: "removed" } });
        return {};
      },
      "catalog.get": (_params, caller) => {
        const catalog: CatalogConnector[] = [];
        for (const { id, instances, resources } of installed()) {
          if (instances.length === 0) continue;
          const kinds = resources
            .map(({ kind }) => kind)
            .filter((kind) =>
              ctx.may(caller, { permission: "data:read", kinds: [kind], sources: [id] }),
            )
            .map((kind) => {
              const of = [...items.values()].filter(
                (i) => i.source.connector === id && i.kind === kind,
              );
              return { kind, fields: fieldsOf(of) };
            });
          if (kinds.length > 0)
            catalog.push({ id, instances: instances.map((i) => i.instance), kinds });
        }
        const commands = ctx
          .commands()
          .filter((c) => ctx.may(caller, { permission: "cmd:invoke", ids: [c.id] }));
        return {
          components: [...COMPONENTS],
          connectors: catalog,
          commands: structuredClone(commands),
        };
      },
    },
  };
}
