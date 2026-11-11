// Mounts the chat plugin on the SDK's test host over an in-memory index of message items, with a
// view that records what it was asked to show, and three chat connectors (acme.slack,
// acme.discord, acme.bridge) whose actions are desk commands that change the index as a real
// connector's sync would. The SDK is imported by its workspace path: plugin folders are not
// workspace packages yet.
import type {
  BridgeEvent,
  CmdInvokePermission,
  DataReadPermission,
  Item,
  ItemKind,
  ItemQuery,
  MessageItem,
} from "../../../packages/bridge/src/index";
import { matches, page } from "../../../packages/bridge/src/stub-query";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { createChat } from "../ui/chat.js";
import { plain } from "../ui/markup.js";
import type { Chrome, Main, Row, ThreadModel } from "../ui/present.js";
import { at, sample } from "./chat-fixtures";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;
type Sidebar = ReturnType<typeof import("../ui/present.js").sidebarOf>;

/** The test's today: Friday 30 October 2026, 9 in the morning in Seoul. */
export const NOW = Date.parse(at(30, "09:00"));
export const CONNECTORS = ["acme.slack", "acme.discord", "acme.bridge"];
export const ACTIONS = ["send", "react", "read", "edit", "delete"] as const;

export interface RecordingView {
  chromes: Chrome[];
  sidebars: Sidebar[];
  mains: Main[];
  threads: Array<ThreadModel | null>;
  statuses: string[];
  focused: string[];
  chrome(model: Chrome): void;
  sidebar(model: Sidebar): void;
  main(model: Main): void;
  thread(model: ThreadModel | null): void;
  status(text: string): void;
  focus(where: string): void;
  /** The navigation now: `group: #name(unread/mentions)` per conversation. */
  nav(): string[];
  /** The rows of the main area now (all panes), one line each: `author: text`, days as [label]. */
  shown(): string[];
  /** The main area now. */
  last(): Main;
}

const line = (row: Row) => {
  if (row.type === "day") return `[${row.label}]`;
  if (row.type === "new") return "--new--";
  const m = row.message;
  const text = m.blocks.map((b) => (b.t === "pre" ? b.v : plain(b.c))).join(" ");
  return `${m.author}: ${text}${m.pending ? ` (${m.pending})` : ""}`;
};

export function recordingView(): RecordingView {
  const view: RecordingView = {
    chromes: [],
    sidebars: [],
    mains: [],
    threads: [],
    statuses: [],
    focused: [],
    chrome: (m) => view.chromes.push(m),
    sidebar: (m) => view.sidebars.push(m),
    main: (m) => view.mains.push(m),
    thread: (m) => view.threads.push(m),
    status: (text) => view.statuses.push(text),
    focus: (where) => view.focused.push(where),
    nav: () =>
      (view.sidebars.at(-1)?.groups ?? []).flatMap((g) =>
        g.rows.map(
          (r) =>
            `${g.title}: ${r.kind === "dm" || r.kind === "group" ? "" : "#"}${r.name}(${r.unread}/${r.mentions})`,
        ),
      ),
    last: () => view.mains.at(-1) as Main,
    shown: () => {
      const main = view.mains.at(-1);
      if (!main) return [];
      if (main.layout === "timeline") return main.rows.map(line);
      const panes =
        main.layout === "conversation"
          ? main.pane
            ? [main.pane]
            : []
          : main.layout === "inbox"
            ? main.cards
            : main.columns;
      return panes.flatMap((p) => p.rows.map(line));
    },
  };
  return view;
}

/** An in-memory index: data.query, data.get, data.subscribe and catalog.get, and its changes. */
export interface Index {
  handlers: Handlers;
  items: Map<string, Item>;
  upsert(item: Item): void;
  remove(source: Item["source"], id: string): void;
  attach(host: TestHost): void;
}

const keyOf = (source: Item["source"], id: string) =>
  `${source.connector}/${source.instance}/${id}`;

export function index(initial: Item[]): Index {
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
      if (item.kind !== "message") continue;
      const set = found.get(item.source.connector) ?? new Set<string>();
      set.add(item.source.instance);
      found.set(item.source.connector, set);
    }
    return [...found].map(([id, instances]) => ({
      id,
      instances: [...instances].sort(),
      kinds: [{ kind: "message" as const, fields: ["title", "from"] }],
    }));
  };
  return {
    items,
    handlers: {
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
    },
    upsert: (item) => {
      const key = keyOf(item.source, item.id);
      const before = items.get(key);
      items.set(key, structuredClone(item));
      announce(before, item);
    },
    remove: (source, id) => {
      const before = items.get(keyOf(source, id));
      items.delete(keyOf(source, id));
      announce(before, undefined);
    },
    attach: (host) => {
      emit = (event) => host.emit(event);
    },
  };
}

/** The connector's side of each action: what a real connector would do to its copy, then sync. */
function connectorActions(
  data: Index,
  connector: string,
): Record<string, (args: unknown) => unknown> {
  let sent = 0;
  const find = (a: Record<string, unknown>) => {
    const item = data.items.get(`${connector}/${a.instance}/${a.id}`);
    return item?.kind === "message" ? item : undefined;
  };
  return {
    send: (args) => {
      const a = args as Record<string, unknown>;
      sent += 1;
      const id = `sent-${sent}`;
      const peer = [...data.items.values()].find(
        (i) =>
          i.source.connector === connector &&
          (i.raw as { channel?: unknown })?.channel === a.channel,
      );
      const item: MessageItem = {
        kind: "message",
        source: { connector, instance: String(a.instance) },
        id,
        title: String(a.text).split("\n")[0] ?? "",
        updatedAt: new Date(NOW + sent * 1000).toISOString(),
        from: { name: "Me" },
        receivedAt: new Date(NOW + sent * 1000).toISOString(),
        unread: false,
        body: String(a.text),
        ...(typeof a.thread === "string" ? { thread: a.thread } : {}),
        raw: {
          ...(peer?.raw ?? {}),
          channel: a.channel,
          self: true,
          mentioned: false,
          reactions: [],
        },
      };
      data.upsert(item);
      return { id };
    },
    react: (args) => {
      const a = args as Record<string, unknown>;
      const item = find(a);
      if (!item) throw new Error("no such message");
      const reactions = (
        (item.raw as { reactions?: Array<Record<string, unknown>> }).reactions ?? []
      ).filter((r) => r.emoji !== a.emoji);
      const held = (
        (item.raw as { reactions?: Array<{ emoji: string; count: number }> }).reactions ?? []
      ).find((r) => r.emoji === a.emoji);
      const count = (held?.count ?? 0) + (a.on ? 1 : -1);
      if (count > 0) reactions.push({ emoji: a.emoji, count, self: a.on === true });
      data.upsert({ ...item, raw: { ...item.raw, reactions } });
      return {};
    },
    read: (args) => {
      const a = args as Record<string, unknown>;
      for (const item of [...data.items.values()])
        if (
          item.kind === "message" &&
          item.source.connector === connector &&
          (item.raw as { channel?: unknown })?.channel === a.channel &&
          item.unread
        )
          data.upsert({ ...item, unread: false });
      return {};
    },
    edit: (args) => {
      const a = args as Record<string, unknown>;
      const item = find(a);
      if (!item) throw new Error("no such message");
      data.upsert({
        ...item,
        body: String(a.text),
        raw: { ...item.raw, editedAt: new Date(NOW).toISOString() },
      });
      return {};
    },
    delete: (args) => {
      const a = args as Record<string, unknown>;
      data.remove({ connector, instance: String(a.instance) }, String(a.id));
      return {};
    },
  };
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createChat>;
  index: Index;
  notices: Array<{ title: string; body: string }>;
  store: Record<string, unknown>;
  params(method: string): unknown[];
  ran(name: string): unknown[];
  settle(): Promise<void>;
}

export interface MountOptions {
  items?: Item[];
  handlers?: Handlers;
  commands?: Commands;
  /** Which actions every connector provides; all five by default. */
  actions?: ReadonlyArray<(typeof ACTIONS)[number]>;
  settings?: Record<string, unknown>;
  init?: Record<string, unknown>;
  store?: Record<string, unknown>;
  pick?: (args: unknown) => string | undefined;
  /** A DOM view to draw into as well (view.js on jsdom), made with a handle on the app. */
  dom?: (app: () => ReturnType<typeof createChat> | undefined) => View;
}

type View = Parameters<typeof createChat>[1];

/** Every call reaches the recording view and, when there is one, the DOM view too. */
function tee(record: RecordingView, dom: View | undefined): View {
  if (!dom) return record;
  return {
    chrome(m) {
      record.chrome(m);
      dom.chrome(m);
    },
    sidebar(m) {
      record.sidebar(m);
      dom.sidebar(m);
    },
    main(m) {
      record.main(m);
      dom.main(m);
    },
    thread(m) {
      record.thread(m);
      dom.thread(m);
    },
    status(t) {
      record.status(t);
      dom.status(t);
    },
    focus(w) {
      record.focus(w);
      dom.focus(w);
    },
  };
}

export const READ: DataReadPermission = { permission: "data:read", kinds: ["message"] };
export const INVOKE: CmdInvokePermission = {
  permission: "cmd:invoke",
  ids: [...ACTIONS.map((a) => `*.chat.${a}`), "desk.palette.pick", "desk.connectors.open"],
};

/** connector.list answering these installed connectors, `[id, title, kinds]`, none connected. */
export const installed = (...connectors: Array<[string, string, ItemKind[]]>): Handlers => ({
  "connector.list": () => ({
    connectors: connectors.map(([id, title, kinds]) => ({
      id,
      title,
      instances: [],
      resources: kinds.map((kind) => ({ kind })),
    })),
  }),
});

export async function mount(options: MountOptions = {}): Promise<Mounted> {
  const store = options.store ?? {};
  const notices: Array<{ title: string; body: string }> = [];
  const data = index(options.items ?? sample());
  const commands: Commands = {
    "desk.palette.pick": (args) => {
      const answer = options.pick?.(args);
      if (answer === undefined) throw new Error("nothing was picked");
      return answer;
    },
  };
  for (const connector of CONNECTORS) {
    const all = connectorActions(data, connector);
    for (const action of options.actions ?? ACTIONS)
      commands[`${connector}.chat.${action}`] = all[action] as never;
  }
  Object.assign(commands, options.commands);
  const host = createTestHost({
    pluginId: "endue.chat",
    handlers: {
      "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
      "store.set": ({ key, value }) => {
        store[key] = value;
        return {};
      },
      "init.get": () => ({ profile: "default", settings: options.init ?? {} }),
      "ui.notify": (params) => {
        notices.push({ title: params.title, body: params.body ?? "" });
        return { notificationId: `n${notices.length}` };
      },
      "shell.open": () => ({ opened: true }),
      ...data.handlers,
      ...options.handlers,
    },
    commands,
    settings: options.settings,
    grants: [READ, INVOKE, { permission: "ui:notify" }, { permission: "connector:manage" }],
    now: () => new Date(NOW).toISOString(),
  });
  data.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createChat> | undefined;
  const drawn = tee(
    view,
    options.dom?.(() => app),
  );
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createChat(ctx, drawn, { now: () => NOW, zone: "Asia/Seoul", saveMs: 0 });
        await app.start();
      },
    },
    host.transport,
  );
  const settle = async () => {
    for (let i = 0; i < 8; i++) await host.settle();
    await new Promise((resolve) => setTimeout(resolve, 5));
    for (let i = 0; i < 4; i++) await host.settle();
  };
  if (!app) throw new Error("the plugin did not mount");
  return {
    host,
    view,
    app,
    index: data,
    notices,
    store,
    params: (method) => host.calls.filter((c) => c.method === method).map((c) => c.params),
    ran: (name) => host.ran.filter((r) => r.name === name).map((r) => r.args),
    settle,
  };
}
