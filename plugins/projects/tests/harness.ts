// Mounts the projects plugin on the SDK's test host over an in-memory index of task items, with a
// view that records every screen it was asked to show, and task connectors whose actions are desk
// commands the test answers: by default Jira provides task.move and task.update, Linear only
// task.move, Asana and the rest nothing. The SDK is imported by its workspace path: plugin folders
// are not workspace packages yet.
import {
  type BridgeEvent,
  type CmdInvokePermission,
  type DataReadPermission,
  type Item,
  type ItemQuery,
  type Permission,
  StubError,
  type TaskItem,
} from "../../../packages/bridge/src/index";
import { matches, page } from "../../../packages/bridge/src/stub-query";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createProjects } from "../ui/app.js";
import type { Screen } from "../ui/present.js";
import { JIRA, LINEAR, sample } from "./fixtures";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;

/** The test's now: Friday 30 October 2026 at noon UTC, the same date in every zone CI runs in. */
export const NOW = Date.parse("2026-10-30T12:00:00Z");

export interface RecordingView {
  screens: Screen[];
  statuses: string[];
  focused: string[];
  render(screen: Screen): void;
  status(text: string): void;
  focus(where: "body" | "detail" | "search"): void;
  /** The latest screen. */
  last(): Screen;
  /** The latest status line. */
  said(): string;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    screens: [],
    statuses: [],
    focused: [],
    render: (screen) => view.screens.push(screen),
    status: (text) => view.statuses.push(text),
    focus: (where) => view.focused.push(where),
    last: () => {
      const screen = view.screens.at(-1);
      if (!screen) throw new Error("nothing was rendered");
      return screen;
    },
    said: () => view.statuses.at(-1) ?? "",
  };
  return view;
}

const keyOf = (source: Item["source"], id: string) =>
  `${source.connector}/${source.instance}/${id}`;

/** An in-memory index: data.*, catalog.get, and the changes a sync makes. */
export function index(initial: Item[]) {
  const items = new Map(initial.map((item) => [keyOf(item.source, item.id), item]));
  const subscriptions = new Map<string, ItemQuery>();
  let emit: ((event: BridgeEvent) => void) | undefined;
  let next = 1;
  const announce = (before: Item | undefined, after: Item | undefined) => {
    for (const [subscriptionId, query] of subscriptions) {
      const sees = (item: Item | undefined): item is Item =>
        item !== undefined && matches(item, query);
      const change = sees(after)
        ? { change: "upserted" as const, item: structuredClone(after) }
        : sees(before)
          ? { change: "removed" as const, source: before.source, id: before.id }
          : undefined;
      if (change) emit?.({ event: "data.changed", data: { subscriptionId, changes: [change] } });
    }
  };
  const connectors = () => {
    const found = new Map<string, Set<string>>();
    for (const item of items.values()) {
      const set = found.get(item.source.connector) ?? new Set<string>();
      set.add(item.source.instance);
      found.set(item.source.connector, set);
    }
    return [...found].map(([id, instances]) => ({
      id,
      instances: [...instances].sort(),
      kinds: [{ kind: "task" as const, fields: ["title", "status", "due"] }],
    }));
  };
  const handlers: Handlers = {
    "data.query": ({ query }) => page([...items.values()], query),
    "data.get": ({ source, id }) => {
      const item = items.get(keyOf(source, id));
      return item ? { item: structuredClone(item) } : {};
    },
    "data.subscribe": ({ query }) => {
      const subscriptionId = `dsub-${next++}`;
      subscriptions.set(subscriptionId, query);
      return { subscriptionId };
    },
    "data.unsubscribe": () => ({}),
    "catalog.get": () => ({ components: [], connectors: connectors(), commands: [] }),
  };
  return {
    items,
    handlers,
    upsert(item: Item) {
      const key = keyOf(item.source, item.id);
      const before = items.get(key);
      items.set(key, structuredClone(item));
      announce(before, item);
    },
    remove(source: Item["source"], id: string) {
      const before = items.get(keyOf(source, id));
      items.delete(keyOf(source, id));
      announce(before, undefined);
    },
    attach(host: TestHost) {
      emit = (event) => host.emit(event);
    },
  };
}

export const READ: DataReadPermission = { permission: "data:read", kinds: ["task"] };
export const INVOKE: CmdInvokePermission = {
  permission: "cmd:invoke",
  ids: ["*.task.move", "*.task.update", "desk.palette.pick", "desk.connectors.open"],
};
export const LINKS: Permission = { permission: "shell:open", schemes: ["https"] };
export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

export interface MountOptions {
  items?: Item[];
  handlers?: Handlers;
  /** Commands the desk provides; added over the default connectors' actions. */
  commands?: Commands;
  /** Which connector actions exist, by id; the default is Jira's move and update and Linear's move. */
  actions?: string[];
  settings?: Record<string, unknown>;
  store?: Record<string, unknown>;
  grants?: Permission[];
  pick?: (args: unknown) => string | undefined;
}

export async function mount(options: MountOptions = {}) {
  const store = options.store ?? {};
  const data = index(options.items ?? sample());
  /** The connector applies a change to its copy and syncs it, as a real one would. */
  const synced = (
    args: unknown,
    change: (item: TaskItem, a: Record<string, unknown>) => TaskItem,
    connector: string,
  ) => {
    const a = args as Record<string, unknown>;
    const item = data.items.get(`${connector}/${a.instance}/${a.id}`);
    if (item?.kind === "task") data.upsert(change(item, a));
    return { ok: true };
  };
  const all: Commands = {
    [`${JIRA}.task.move`]: (args) =>
      synced(
        args,
        (item, a) => {
          const raw = item.raw as { fields: Record<string, unknown> };
          return {
            ...item,
            raw: { ...raw, fields: { ...raw.fields, status: { name: a.status } } },
          };
        },
        JIRA,
      ),
    [`${JIRA}.task.update`]: (args) =>
      synced(
        args,
        (item, a) => {
          const raw = item.raw as { fields: Record<string, unknown> };
          const fields = {
            ...raw.fields,
            ...("due" in a ? { duedate: a.due } : {}),
            ...("start" in a ? { customfield_10015: a.start } : {}),
          };
          return { ...item, raw: { ...raw, fields } };
        },
        JIRA,
      ),
    [`${LINEAR}.task.move`]: () => ({ ok: true }),
  };
  const commands: Commands = {
    "desk.palette.pick": (args) => {
      const answer = options.pick?.(args);
      if (answer === undefined) throw new Error("nothing was picked");
      return answer;
    },
  };
  for (const id of options.actions ?? Object.keys(all)) if (all[id]) commands[id] = all[id];
  Object.assign(commands, options.commands);
  const host = createTestHost({
    pluginId: "endue.projects",
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: {} }),
      ...data.handlers,
      ...options.handlers,
    },
    commands,
    settings: options.settings,
    grants: options.grants ?? [READ, INVOKE, LINKS],
    now: () => new Date(NOW).toISOString(),
  });
  data.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createProjects> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createProjects(ctx, view, { now: () => NOW });
        await app.start();
      },
    },
    host.transport,
  );
  if (!app) throw new Error("the plugin did not mount");
  const settle = async () => {
    for (let i = 0; i < 8; i++) await host.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 4; i++) await host.settle();
  };
  return {
    host,
    view,
    app,
    index: data,
    store,
    settle,
    params: (method: string) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name: string) => host.ran.filter((r) => r.name === name).map((r) => r.args),
  };
}

export type Mounted = Awaited<ReturnType<typeof mount>>;
