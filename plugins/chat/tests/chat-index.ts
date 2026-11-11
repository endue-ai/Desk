// The chat tests' index of message items, which harness.ts mounts the plugin over: data.query,
// data.get, data.subscribe and catalog.get over a map, its changes as data.changed, and the
// connector's side of each chat action, which changes the index as a real connector's sync would.
import type { BridgeEvent, Item, ItemQuery, MessageItem } from "../../../packages/bridge/src/index";
import { matches, page } from "../../../packages/bridge/src/stub-query";
import type { createTestHost, TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import { at } from "./chat-fixtures";

type Options = Parameters<typeof createTestHost>[0];
export type Handlers = NonNullable<Options["handlers"]>;

/** The test's today: Friday 30 October 2026, 9 in the morning in Seoul. */
export const NOW = Date.parse(at(30, "09:00"));

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
export function connectorActions(
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
