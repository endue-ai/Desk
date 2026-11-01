// Mounts the mail plugin on the SDK's test host over an in-memory index of message items, with a
// view that records what it was asked to show and a mail connector `acme.imap` whose actions are
// desk commands the test answers. The SDK is imported by its workspace path: plugin folders are not
// workspace packages yet.
import {
  type BridgeEvent,
  type CmdInvokePermission,
  type DataReadPermission,
  type Item,
  type ItemQuery,
  type MessageItem,
  StubError,
} from "../../../packages/bridge/src/index";
import { matches, page } from "../../../packages/bridge/src/stub-query";
import { defineUiPlugin } from "../../../packages/plugin-sdk/src/index";
import { createTestHost, type TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { CONNECTOR, sample } from "./mail-fixtures";

export { CONNECTOR, INVITE, ME, message, SOURCE, sample } from "./mail-fixtures";

import type { Draft } from "../ui/compose.js";
import { createMail } from "../ui/mail.js";
import type { Nav, ReaderModel, Row } from "../ui/present.js";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;
export type Commands = NonNullable<Options["commands"]>;
type ListState = { more: boolean; loading: boolean; empty: string };

export const ACCOUNT = `${CONNECTOR}/work`;
/** The test's today: Friday 30 October 2026, 9 in the morning in Seoul. */
export const NOW = Date.parse("2026-10-30T09:00:00+09:00");

export interface RecordingView {
  navs: Nav[];
  lists: Array<{ rows: Row[]; selected: string | null; state: ListState }>;
  readers: Array<ReaderModel | null>;
  composers: Array<{ draft: Draft | null; problems: string[] }>;
  statuses: string[];
  focused: string[];
  nav(nav: Nav): void;
  list(rows: Row[], selected: string | null, state: ListState): void;
  reader(model: ReaderModel | null): void;
  composer(draft: Draft | null, problems: string[]): void;
  status(text: string): void;
  focus(where: "list" | "reader" | "composer"): void;
  /** The latest list, one line per row: `title|people|unread|count`, `*` when flagged. */
  shown(): string[];
  selected(): string | null;
  /** The message the reader shows now, by id, or null. */
  reading(): string | null;
  draft(): Draft | null;
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    navs: [],
    lists: [],
    readers: [],
    composers: [],
    statuses: [],
    focused: [],
    nav: (nav) => view.navs.push(nav),
    list: (rows, selected, state) => view.lists.push({ rows, selected, state }),
    reader: (model) => view.readers.push(model),
    composer: (draft, problems) => view.composers.push({ draft, problems }),
    status: (text) => view.statuses.push(text),
    focus: (where) => view.focused.push(where),
    shown: () =>
      (view.lists.at(-1)?.rows ?? []).map(
        (row) => `${row.title}|${row.people}|${row.unread}|${row.count}${row.flagged ? "*" : ""}`,
      ),
    selected: () => view.lists.at(-1)?.selected ?? null,
    reading: () => view.readers.at(-1)?.message.id ?? null,
    draft: () => view.composers.at(-1)?.draft ?? null,
  };
  return view;
}

/** An in-memory index: data.query, data.get, data.subscribe and catalog.get, and the changes a sync makes. */
export interface Index {
  handlers: Handlers;
  items: Map<string, Item>;
  /** Put an item in, or replace it, and tell the subscribers. */
  upsert(item: Item): void;
  /** Take an item out and tell the subscribers. */
  remove(source: Item["source"], id: string): void;
  /** Hook the host up so data.changed reaches the plugin. */
  attach(host: TestHost): void;
}

const keyOf = (source: Item["source"], id: string) =>
  `${source.connector}/${source.instance}/${id}`;

export function index(initial: Item[] = []): Index {
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

export const denied = (what: string) =>
  new StubError("permission_denied", `${what} is not granted`);

/** The core's store, init.yaml and notifications, in memory. */
function core(
  store: Record<string, unknown>,
  init: Record<string, unknown>,
  notices: unknown[],
): Handlers {
  return {
    "store.get": ({ key }) => (key in store ? { value: store[key] } : {}),
    "store.set": ({ key, value }) => {
      store[key] = value;
      return {};
    },
    "init.get": () => ({ profile: "default", settings: init }),
    "ui.notify": (params) => {
      notices.push({ title: params.title, body: params.body });
      return { notificationId: `n${notices.length}` };
    },
  };
}

export interface Mounted {
  host: TestHost;
  view: RecordingView;
  app: ReturnType<typeof createMail>;
  index: Index;
  /** Every notification the plugin showed. */
  notices: unknown[];
  /** The store, which the plugin writes into. */
  store: Record<string, unknown>;
  /** The params of every call to one bridge method. */
  params(method: string): unknown[];
  /** The args of every run of one desk command. */
  ran(name: string): unknown[];
  /** Wait until the plugin is quiet: calls answered and follow-up calls answered too. */
  settle(): Promise<void>;
}

export interface MountOptions {
  items?: Item[];
  handlers?: Handlers;
  /** The connector's actions the desk provides; by default send, move and flag that succeed. */
  commands?: Commands;
  /** Which actions the connector provides; the default is all three. */
  actions?: Array<"send" | "move" | "flag">;
  settings?: Record<string, unknown>;
  init?: Record<string, unknown>;
  store?: Record<string, unknown>;
  pick?: (args: unknown) => string | undefined;
}

export const READ: DataReadPermission = { permission: "data:read", kinds: ["message"] };
export const INVOKE: CmdInvokePermission = {
  permission: "cmd:invoke",
  ids: ["*.mail.send", "*.mail.move", "*.mail.flag", "desk.palette.pick"],
};

export async function mount(options: MountOptions = {}): Promise<Mounted> {
  const store = options.store ?? {};
  const notices: unknown[] = [];
  const data = index(options.items ?? sample());
  const commands: Commands = {
    "desk.palette.pick": (args) => {
      const answer = options.pick?.(args);
      if (answer === undefined) throw new Error("nothing was picked");
      return answer;
    },
  };
  // The connector applies a flag or a move to its copy and syncs it: the index changes too.
  const applied = (
    args: unknown,
    change: (item: MessageItem, a: Record<string, unknown>) => MessageItem,
  ) => {
    const a = args as Record<string, unknown>;
    const key = `${CONNECTOR}/${a.instance}/${a.id}`;
    const item = data.items.get(key);
    if (item?.kind === "message") data.upsert(change(item, a));
    return { ok: true };
  };
  const actions: Commands = {
    [`${CONNECTOR}.mail.send`]: () => ({ ok: true }),
    [`${CONNECTOR}.mail.move`]: (args) =>
      applied(args, (item, a) => ({ ...item, raw: { ...item.raw, mailbox: a.mailbox } })),
    [`${CONNECTOR}.mail.flag`]: (args) =>
      applied(args, (item, a) => ({
        ...item,
        ...(typeof a.unread === "boolean" ? { unread: a.unread } : {}),
        raw: { ...item.raw, ...(typeof a.flagged === "boolean" ? { flagged: a.flagged } : {}) },
      })),
  };
  for (const action of options.actions ?? ["send", "move", "flag"])
    commands[`${CONNECTOR}.mail.${action}`] = actions[`${CONNECTOR}.mail.${action}`] as never;
  Object.assign(commands, options.commands);
  const host = createTestHost({
    pluginId: "endue.mail",
    handlers: {
      ...core(store, options.init ?? {}, notices),
      ...data.handlers,
      ...options.handlers,
    },
    commands,
    settings: options.settings,
    grants: [READ, INVOKE, { permission: "ui:notify" }],
    now: () => new Date(NOW).toISOString(),
  });
  data.attach(host);
  const view = recordingView();
  let app: ReturnType<typeof createMail> | undefined;
  await defineUiPlugin(
    {
      async mount(ctx) {
        app = createMail(ctx, view, { now: () => NOW, recountMs: 0 });
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
  // defineUiPlugin awaits app.start(), including its initial queries and subscription.
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
