import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  type BridgeEvent,
  browserStub,
  type DataReadPermission,
  type Item,
  type ItemQuery,
  type StubOptions,
  stubCommands,
  type View,
} from "./index";

function setup(options: StubOptions = {}) {
  const events: BridgeEvent[] = [];
  const core = stubCommands((event) => events.push(event), options);
  const client = new BridgeClient(browserStub(core.handlers));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const of = <N extends BridgeEvent["event"]>(name: N) =>
    events.filter((e) => e.event === name) as Array<Extract<BridgeEvent, { event: N }>>;
  return { client, core, events, of, settle };
}

const VIEW = { caller: "example.view" };
const OTHER = { caller: "example.other" };
const source = { connector: "desk.fixtures", instance: "default" };
const read = (more: Omit<DataReadPermission, "permission"> = {}): DataReadPermission => ({
  permission: "data:read",
  ...more,
});
const CONNECTORS = { permission: "connector:manage" } as const;
const VIEWS = { permission: "view:manage" } as const;
const ids = (items: Item[]) => items.map((item) => item.id);
const words = (text: string) => text.split(" ");

describe("the stub's items", () => {
  it("data.query filters by kind, source, text and where, sorts, and pages with a cursor", async () => {
    const { client } = setup();
    const query = async (q: ItemQuery) =>
      ids((await client.call("data.query", { query: q, scope: read() })).items);

    expect(await query({ kinds: ["task"] })).toEqual([
      "task-report",
      "task-groceries",
      "task-invoice",
    ]);
    expect(await query({ kinds: ["note"], sources: ["desk.fixtures/default"] })).toEqual([
      "note-offsite",
      "note-stew",
    ]);
    expect(await query({ sources: ["desk.fixtures/work"] })).toEqual([]);
    expect(await query({ sources: ["example.mail"] })).toEqual([]);
    expect(await query({ text: "lunch" })).toEqual(["msg-mina", "ev-lunch", "note-offsite"]);
    expect(
      await query({ kinds: ["task"], where: [{ field: "status", op: "eq", value: "open" }] }),
    ).toEqual(["task-report", "task-groceries"]);
    expect(
      await query({ where: [{ field: "raw.labels", op: "contains", value: "work" }] }),
    ).toEqual(["task-report", "ev-review", "msg-build", "ev-standup", "note-offsite"]);
    const today = await query({
      kinds: ["event"],
      where: [
        { field: "start", op: "gte", value: "2026-10-30T00:00:00+09:00" },
        { field: "start", op: "lt", value: "2026-10-30T15:00:00Z" },
      ],
      sort: [{ field: "start", dir: "asc" }],
    });
    expect(today).toEqual(["ev-standup", "ev-lunch", "ev-review"]);

    const pages: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await client.call("data.query", {
        query: { limit: 5, ...(cursor ? { cursor } : {}) },
        scope: read(),
      });
      pages.push(ids(page.items));
      cursor = page.cursor;
    } while (cursor);
    expect(pages.map((p) => p.length)).toEqual([5, 5, 2]);
    expect(pages.flat()).toEqual(await query({}));
    expect(pages.flat()[0]).toBe("task-report");
    await expect(
      client.call("data.query", { query: { cursor: "nope" }, scope: read() }),
    ).rejects.toMatchObject({ code: "invalid_params" });
    await expect(
      client.call("data.query", { query: { sources: ["$calendar"] }, scope: read() }),
    ).rejects.toMatchObject({ code: "invalid_params" });
  });

  it("data.query without a covering data:read scope is permission_denied naming the scope", async () => {
    const { client } = setup({ grants: { "example.view": [read({ kinds: ["task"] })] } });
    const wider = read({ kinds: ["task", "event"] });
    await expect(
      client.call("data.query", { query: { kinds: ["task"] }, scope: wider }, VIEW),
    ).rejects.toMatchObject({ code: "permission_denied", permission: wider });
    await expect(
      client.call("data.query", { query: {}, scope: read() }, OTHER),
    ).rejects.toMatchObject({ code: "permission_denied", permission: read() });
    // The scope narrows what a query sees: items it does not cover are left out, not refused.
    const page = await client.call(
      "data.query",
      { query: { kinds: ["event", "task"] }, scope: read({ kinds: ["task"] }) },
      VIEW,
    );
    expect(ids(page.items)).toEqual(["task-report", "task-groceries", "task-invoice"]);
  });

  it("data.get answers the item or an absent value", async () => {
    const { client } = setup();
    const { item } = await client.call("data.get", { source, id: "task-report", scope: read() });
    expect(item).toMatchObject({ id: "task-report", kind: "task", source, status: "open" });
    await expect(
      client.call("data.get", { source, id: "task-nope", scope: read() }),
    ).resolves.toEqual({});
    await expect(
      client.call("data.get", { source, id: "ev-lunch", scope: read({ kinds: ["task"] }) }),
    ).resolves.toEqual({});
    await expect(
      client.call("data.get", {
        source: { ...source, instance: "work" },
        id: "task-report",
        scope: read(),
      }),
    ).resolves.toEqual({});
  });

  it("data.subscribe delivers data.changed to the subscriber when a fixture item is upserted or removed, and unsubscribe ends it", async () => {
    const tasks = read({ kinds: ["task"] });
    const { client, core, of, settle } = setup({ grants: { "example.view": [tasks] } });
    const open: ItemQuery = {
      kinds: ["task"],
      where: [{ field: "status", op: "eq", value: "open" }],
    };
    const { subscriptionId } = await client.call(
      "data.subscribe",
      { query: open, scope: tasks },
      VIEW,
    );
    const call: Item = {
      id: "task-call",
      source,
      kind: "task",
      title: "Call the bank",
      updatedAt: "2026-10-30T09:05:00+09:00",
      status: "open",
    };
    core.upsert(call);
    core.upsert({
      id: "ev-call",
      source,
      kind: "event",
      title: "Call",
      updatedAt: "2026-10-30T09:06:00+09:00",
      start: "2026-10-30T11:00:00+09:00",
      end: "2026-10-30T11:30:00+09:00",
    });
    expect(core.remove(source, "task-report")).toBe(true);
    expect(core.remove(source, "task-report")).toBe(false);
    const groceries = await client.call("data.get", { source, id: "task-groceries", scope: tasks });
    core.upsert({ ...(groceries.item as Item), status: "done" } as Item);
    await settle();

    const changed = of("data.changed");
    expect(changed.map((e) => e.data)).toEqual([
      { subscriptionId, changes: [{ change: "upserted", item: call }] },
      { subscriptionId, changes: [{ change: "removed", source, id: "task-report" }] },
      { subscriptionId, changes: [{ change: "removed", source, id: "task-groceries" }] },
    ]);
    expect(changed.map((e) => core.audience(e))).toEqual([
      ["example.view"],
      ["example.view"],
      ["example.view"],
    ]);
    const now = await client.call("data.query", { query: open, scope: tasks }, VIEW);
    expect(ids(now.items)).toEqual(["task-call"]);

    await expect(client.call("data.unsubscribe", { subscriptionId }, OTHER)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(client.call("data.unsubscribe", { subscriptionId }, VIEW)).resolves.toEqual({});
    await expect(client.call("data.unsubscribe", { subscriptionId }, VIEW)).rejects.toMatchObject({
      code: "not_found",
    });
    core.upsert({ ...call, title: "Call the bank back" });
    await settle();
    expect(of("data.changed")).toHaveLength(3);
  });
});

const TODAY: View = {
  id: "example.today",
  version: "0.1.0",
  title: "Today",
  description: "Today's events.",
  requires: { calendar: { kinds: ["event"] } },
  layout: {
    type: "agenda",
    range: "day",
    binding: { kinds: ["event"], sources: ["$calendar"] },
    fields: [{ value: "{start|time} {title}" }],
  },
};
/** TODAY as view.list sums it up: the stub's views are all the person's files. */
const SUMMARY = { id: "example.today", version: "0.1.0", title: "Today", source: "file" } as const;

describe("the stub's views and connectors", () => {
  it("the stub's views are the person's: view.list and view.get answer source file", async () => {
    const { client } = setup();
    await client.call("view.save", { view: TODAY, scope: VIEWS });
    const { views } = await client.call("view.list", { scope: VIEWS });
    expect(views).toEqual([{ ...SUMMARY, description: "Today's events." }]);
    expect(views[0]).not.toHaveProperty("plugin");
    const got = await client.call("view.get", { id: "example.today", scope: VIEWS });
    expect(got).toEqual({ view: TODAY, source: "file" });
    expect(got).not.toHaveProperty("plugin");
  });

  it("view.save keeps a valid view, view.list and view.get return it, view.remove drops it, and an invalid view is invalid_params", async () => {
    const MANAGER = { caller: "example.views" };
    const { client, core, of, settle } = setup({ grants: { "example.views": [VIEWS] } });
    await expect(client.call("view.list", { scope: VIEWS }, OTHER)).rejects.toMatchObject({
      code: "permission_denied",
      permission: VIEWS,
    });
    await expect(client.call("view.list", { scope: VIEWS })).resolves.toEqual({ views: [] });
    await expect(client.call("view.save", { view: TODAY, scope: VIEWS }, MANAGER)).resolves.toEqual(
      {},
    );
    await expect(client.call("view.list", { scope: VIEWS }, MANAGER)).resolves.toEqual({
      views: [{ ...SUMMARY, description: "Today's events." }],
    });
    await expect(
      client.call("view.get", { id: "example.today", scope: VIEWS }, MANAGER),
    ).resolves.toEqual({ view: TODAY, source: "file" });

    const unresolved = { ...TODAY, layout: { type: "list", binding: { sources: ["$mail"] } } };
    const noLayout = { id: "example.bare", version: "0.1.0", title: "Bare" } as unknown as View;
    const unknownType = { ...TODAY, layout: { type: "carousel" } } as unknown as View;
    for (const view of [unresolved, noLayout, unknownType] as View[])
      await expect(client.call("view.save", { view, scope: VIEWS })).rejects.toMatchObject({
        code: "invalid_params",
      });
    await expect(client.call("view.get", { id: "example.today", scope: VIEWS })).resolves.toEqual({
      view: TODAY,
      source: "file",
    });

    await expect(
      client.call("view.remove", { id: "example.today", scope: VIEWS }, MANAGER),
    ).resolves.toEqual({});
    await expect(
      client.call("view.get", { id: "example.today", scope: VIEWS }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      client.call("view.remove", { id: "example.today", scope: VIEWS }),
    ).rejects.toMatchObject({ code: "not_found" });
    await settle();
    const changed = of("view.changed");
    expect(changed.map((e) => e.data)).toEqual([
      { id: "example.today", change: "saved" },
      { id: "example.today", change: "removed" },
    ]);
    expect(core.audience(changed[0] as BridgeEvent)).toEqual(["example.views"]);
  });

  it("connector.list names the fixture connector with its instance and status", async () => {
    const { client } = setup();
    await expect(client.call("connector.list", { scope: CONNECTORS }, OTHER)).rejects.toMatchObject(
      { code: "permission_denied", permission: CONNECTORS },
    );
    const { connectors } = await client.call("connector.list", { scope: CONNECTORS });
    expect(connectors).toEqual([
      {
        id: "desk.fixtures",
        instances: [
          {
            connector: "desk.fixtures",
            instance: "default",
            title: "Fixtures",
            settings: {},
            status: { state: "connected", lastSyncAt: "2026-10-30T08:55:00+09:00" },
          },
        ],
        resources: [{ kind: "event" }, { kind: "task" }, { kind: "note" }, { kind: "message" }],
      },
    ]);
  });

  it("connector.connect, sync and disconnect tell connector:manage holders with connector.changed", async () => {
    const RAIL = { caller: "example.rail" };
    const { client, core, of, settle } = setup({ grants: { "example.rail": [CONNECTORS] } });
    const connect = (
      params: { instance?: string; settings?: Record<string, unknown> },
      connector = "desk.fixtures",
    ) => client.call("connector.connect", { connector, ...params, scope: CONNECTORS }, RAIL);
    await expect(
      connect({ instance: "work", settings: { folder: "~/Work", token: "s3cret" } }),
    ).resolves.toEqual({ instance: "work" });
    await expect(connect({})).rejects.toMatchObject({ code: "already_exists" });
    await expect(connect({ instance: "home" }, "example.none")).rejects.toMatchObject({
      code: "not_found",
    });
    for (const settings of [{ color: "red" }, { folder: 3 }])
      await expect(connect({ instance: "home", settings })).rejects.toMatchObject({
        code: "invalid_params",
      });
    const listed = await client.call("connector.list", { scope: CONNECTORS }, RAIL);
    expect(listed.connectors[0]?.instances.map((i) => [i.instance, i.settings])).toEqual([
      ["default", {}],
      ["work", { folder: "~/Work" }],
    ]);

    const work = { connector: "desk.fixtures", instance: "work" };
    const scoped = { ...work, scope: CONNECTORS };
    await expect(client.call("connector.sync", scoped, RAIL)).resolves.toEqual({ started: true });
    await expect(
      client.call("connector.sync", { ...scoped, instance: "home" }, RAIL),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await client.call("data.query", { query: {}, scope: read() })).items).toHaveLength(12);
    await expect(
      client.call("connector.disconnect", { ...scoped, instance: "default" }, RAIL),
    ).resolves.toEqual({});
    await expect(client.call("data.query", { query: {}, scope: read() })).resolves.toEqual({
      items: [],
    });
    await expect(
      client.call("connector.disconnect", { ...scoped, instance: "default" }, RAIL),
    ).rejects.toMatchObject({ code: "not_found" });
    await settle();

    const changed = of("connector.changed");
    expect(changed.map((e) => e.data)).toEqual([
      { ...work, change: "connected", status: { state: "connected" } },
      { ...work, change: "updated", status: { state: "syncing" } },
      {
        ...work,
        change: "updated",
        status: { state: "connected", lastSyncAt: "2026-10-30T09:00:00+09:00" },
      },
      { connector: "desk.fixtures", instance: "default", change: "disconnected" },
    ]);
    expect(changed.map((e) => core.audience(e))).toEqual([
      ["example.rail"],
      ["example.rail"],
      ["example.rail"],
      ["example.rail"],
    ]);
  });

  it("catalog.get lists the components, the fixture connector's kinds and fields, and only the commands the caller may invoke", async () => {
    const { client } = setup({
      grants: {
        "example.view": [read({ kinds: ["task"] }), { permission: "cmd:invoke", ids: ["desk.*"] }],
      },
    });
    await client.call("cmd.register", { id: "desk.fixtures.complete", title: "Complete" });
    await client.call(
      "cmd.register",
      { id: "example.notes.new", title: "New note" },
      { caller: "example.notes" },
    );
    const mine = await client.call("catalog.get", {}, VIEW);
    expect(mine.components).toEqual(
      words("list table card detail calendar agenda kanban chart markdown stat"),
    );
    expect(mine.connectors).toEqual([
      {
        id: "desk.fixtures",
        instances: ["default"],
        kinds: [
          {
            kind: "task",
            fields: words(
              "completedAt due id kind priority project raw.labels source status title updatedAt",
            ),
          },
        ],
      },
    ]);
    expect(mine.commands.map((c) => c.id)).toEqual(["desk.fixtures.complete"]);

    const desk = await client.call("catalog.get", {});
    const kinds = desk.connectors[0]?.kinds.map((k) => k.kind);
    expect(kinds).toEqual(words("event task note message"));
    expect(desk.commands.map((c) => c.id)).toEqual(["desk.fixtures.complete", "example.notes.new"]);
    await expect(client.call("catalog.get", {}, OTHER)).resolves.toMatchObject({
      connectors: [],
      commands: [],
    });
  });
});
