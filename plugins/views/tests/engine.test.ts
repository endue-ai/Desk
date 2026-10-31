import { describe, expect, it } from "vitest";
import {
  type ConnectorStatus,
  FIXTURE_CONNECTOR,
  fixtureConnector,
  type Item,
  type View,
} from "../../../packages/bridge/src/index";
import type { ComponentModel } from "../ui/engine.js";
import { present } from "../ui/present.js";
import { CONNECTORS, manifest, mount, VIEWS, vector } from "./harness";

const today = vector("view-today");
const source = { connector: FIXTURE_CONNECTOR, instance: "default" };
const plants: Item = {
  kind: "task",
  id: "task-plants",
  source,
  title: "Water the plants",
  updatedAt: "2026-10-30T08:59:00+09:00",
  status: "open",
  due: "2026-10-30T18:00:00+09:00",
};
const read = (kind: string) => ({
  permission: "data:read",
  kinds: [kind],
  sources: [FIXTURE_CONNECTOR],
});
const ids = (items: Item[]) => items.map((item) => item.id);
/** connector.list answering desk.fixtures/default in the given status. */
const listing = (status: ConnectorStatus) => ({
  "connector.list": () => {
    const { id, resources, instances } = fixtureConnector();
    return { connectors: [{ id, resources, instances: instances.map((i) => ({ ...i, status })) }] };
  },
});

describe("desk.views", () => {
  it("an agenda with range day queries from {today} to {tomorrow} and draws the now line from the clock", async () => {
    const m = await mount({ views: [today] });
    await m.open({ id: "desk.today" });
    const [agenda] = m.params("data.query") as Array<{ query: { where: unknown } }>;
    expect(agenda?.query.where).toEqual([
      { field: "start", op: "lt", value: "2026-10-31T00:00:00+09:00" },
      { field: "end", op: "gt", value: "2026-10-30T00:00:00+09:00" },
    ]);
    const [schedule] = m.shown();
    expect(ids(schedule?.items ?? [])).toEqual(["ev-standup", "ev-lunch", "ev-review"]);
    const model = m.view.drawn.at(-1);
    if (!model) throw new Error("nothing was drawn");
    const drawn = present(schedule as ComponentModel, model.env) as {
      events: Array<{ title: string }>;
    };
    expect(drawn).toMatchObject({ kind: "agenda", now: "2026-10-30T09:00:00+09:00" });
    expect(drawn.events.map((event) => event.title)).toEqual([
      "10:00 Team standup",
      "12:30 Lunch with Mina",
      "16:00 Design review",
    ]);
  });

  it("open reads the view, resolves requires, queries and subscribes every binding, then shows the surface", async () => {
    let n = 0;
    const visibleAtSubscribe: unknown[] = [];
    const m = await mount({
      views: [today, vector("view-calendar-and-detail")],
      handlers: {
        "data.subscribe": () => {
          visibleAtSubscribe.push(m.host.visible);
          n += 1;
          return { subscriptionId: `s${n}` };
        },
      },
    });
    expect(m.host.visible).toBeUndefined();
    await m.open({ id: "desk.today" });
    const scoped = m.host.calls
      .filter((call) => call.method !== "cmd.answer")
      .map((call) => [call.method, (call.params as { scope?: unknown }).scope]);
    expect(scoped).toEqual([
      ["view.get", VIEWS],
      ["connector.list", CONNECTORS],
      ["data.query", read("event")],
      ["data.subscribe", read("event")],
      ["data.query", read("task")],
      ["data.subscribe", read("task")],
    ]);
    expect(visibleAtSubscribe).toEqual([undefined, undefined]);
    expect(m.host.visible).toBe(true);
    expect(m.shown().map((c) => [c.type, c.state, c.title])).toEqual([
      ["agenda", "ready", "Schedule"],
      ["list", "ready", "To do"],
    ]);
    expect(ids(m.shown()[1]?.items ?? [])).toEqual(["task-report", "task-groceries"]);
    expect(m.view.drawn.at(-1)?.title).toBe("Today");

    await m.open({ id: "example.week" });
    expect(m.shown().map((c) => [c.type, c.state, c.message])).toEqual([
      ["calendar", "placeholder", "Calendar comes later"],
      ["detail", "placeholder", "Detail comes later"],
    ]);
    expect(m.params("data.query")).toHaveLength(2);
  });

  it("several instances ask desk.palette.pick before the surface shows; a cancel draws unbound with Connect a source", async () => {
    const picks: Array<{ args: unknown; visible: unknown }> = [];
    let answer: (args: unknown) => unknown = () => "desk.fixtures/work";
    const m = await mount({
      views: [today],
      commands: {
        "desk.palette.pick": (args) => {
          picks.push({ args, visible: m.host.visible });
          return answer(args);
        },
      },
    });
    await m.host.call("connector.connect", {
      connector: FIXTURE_CONNECTOR,
      instance: "work",
      title: "Work",
      scope: CONNECTORS,
    });
    await m.open({ id: "desk.today" });
    const items = [
      { id: "desk.fixtures/default", label: "Fixtures", detail: "desk.fixtures · connected" },
      { id: "desk.fixtures/work", label: "Work", detail: "desk.fixtures · connected" },
    ];
    expect(picks).toEqual([
      { args: { title: "A calendar", items }, visible: undefined },
      { args: { title: "A task list", items }, visible: undefined },
    ]);
    const queried = m.params("data.query") as Array<{ query: { sources: string[] } }>;
    expect(queried.map((p) => p.query.sources)).toEqual([
      ["desk.fixtures/work"],
      ["desk.fixtures/work"],
    ]);
    expect(m.shown().map((c) => c.state)).toEqual(["empty", "empty"]);
    expect(m.shown().map((c) => c.message)).toEqual([
      "Nothing on the calendar today.",
      "Nothing left to do.",
    ]);

    answer = () => {
      throw new Error("nothing was picked");
    };
    await m.open({ id: "desk.today" });
    expect(m.shown().map((c) => [c.state, c.kinds])).toEqual([
      ["unbound", ["event"]],
      ["unbound", ["task"]],
    ]);
    expect(m.params("data.query")).toHaveLength(2);
    expect(m.host.visible).toBe(true);
    const tasks = m.shown()[1];
    await m.engine.connect(tasks?.path ?? "");
    await m.settle();
    expect(m.host.ran.at(-1)).toEqual({ name: "desk.connectors.open", args: { kinds: ["task"] } });
    expect(m.shown()[1]).toMatchObject({
      state: "unbound",
      message: "Connecting a source comes later.",
    });
  });

  it("a data.changed re-queries only the component it names, keeping its items until the answer", async () => {
    const m = await mount({ views: [today] });
    await m.open({ id: "desk.today" });
    const [agendaQuery, listQuery] = m.params("data.query");
    m.host.upsert(plants);
    await m.settle();
    expect(m.params("data.query")).toEqual([agendaQuery, listQuery, listQuery]);
    expect(ids(m.shown()[1]?.items ?? [])).toEqual([
      "task-report",
      "task-plants",
      "task-groceries",
    ]);
    // Updated in place: no redraw, no second view.get, and never without its items.
    expect(m.view.drawn).toHaveLength(1);
    expect(m.params("view.get")).toHaveLength(1);
    expect(m.view.updated.length).toBeGreaterThan(0);
    for (const update of m.view.updated) {
      expect(update.state).toBe("ready");
      expect(update.items.length).toBeGreaterThan(0);
    }
    m.host.remove(source, plants.id);
    await m.settle();
    expect(ids(m.shown()[1]?.items ?? [])).toEqual(["task-report", "task-groceries"]);
    expect(m.params("data.query")).toHaveLength(4);
  });

  it("stale, error and a refused query draw stale, error and denied, with reconnect and request-access as commands", async () => {
    const stale = await mount({
      views: [today],
      handlers: listing({ state: "stale", lastSyncAt: "2026-10-30T08:00:00+09:00" }),
    });
    await stale.open({ id: "desk.today" });
    expect(stale.shown().map((c) => [c.state, c.message])).toEqual([
      ["stale", "Last synced 1 hour ago"],
      ["stale", "Last synced 1 hour ago"],
    ]);
    expect(ids(stale.shown()[1]?.items ?? [])).toEqual(["task-report", "task-groceries"]);

    const reason = "The fixture source stopped answering.";
    const broken = await mount({
      views: [today],
      handlers: listing({ state: "error", error: { message: reason } }),
    });
    await broken.open({ id: "desk.today" });
    const [schedule, todo] = broken.shown();
    expect([schedule?.state, todo?.state, todo?.message]).toEqual(["error", "error", reason]);
    expect(ids(todo?.items ?? [])).toEqual(["task-report", "task-groceries"]);
    expect(todo?.instance).toEqual(source);
    await broken.engine.reconnect(todo?.path ?? "");
    await broken.settle();
    expect(broken.host.ran).toContainEqual({ name: "desk.views.reconnect", args: source });
    expect(broken.params("connector.sync")).toEqual([{ ...source, scope: CONNECTORS }]);
    // The sync's connector.changed (syncing, then connected) brings the components back.
    expect(broken.shown().map((c) => c.state)).toEqual(["ready", "ready"]);

    const narrow = [
      { permission: "data:read" as const, kinds: ["event" as const] },
      ...(manifest().permissions ?? []).filter((p) => p.permission !== "data:read"),
    ];
    const denied = await mount({ views: [today], grants: narrow });
    await denied.open({ id: "desk.today" });
    expect(denied.shown().map((c) => c.state)).toEqual(["ready", "denied"]);
    const refused = denied.shown()[1];
    expect(refused?.scope).toEqual(read("task"));
    await denied.engine.requestAccess(refused?.path ?? "");
    await denied.settle();
    expect(denied.host.ran).toContainEqual({
      name: "desk.views.request-access",
      args: { kinds: ["task"], sources: [FIXTURE_CONNECTOR] },
    });
    expect(denied.params("perm.request")).toEqual([
      { permission: read("task"), reason: expect.any(String) },
    ]);
    expect(denied.shown().map((c) => c.state)).toEqual(["ready", "ready"]);
  });

  it("a view.changed re-renders the open view; closing it or opening another ends every subscription", async () => {
    const empty: View = {
      id: "test.empty",
      version: "0.1.0",
      title: "Overdue",
      requires: { tasks: { kinds: ["task"] } },
      layout: {
        type: "list",
        binding: {
          kinds: ["task"],
          sources: ["$tasks"],
          where: [{ field: "due", op: "lt", value: "{yesterday}" }],
        },
        empty: "Nothing due",
      },
    };
    const m = await mount({ views: [today, empty] });
    await m.open({ id: "desk.today" });
    await m.host.call("view.save", { view: { ...today, title: "Today, again" }, scope: VIEWS });
    await m.settle();
    expect(m.view.drawn.at(-1)?.title).toBe("Today, again");
    expect(m.params("view.get")).toHaveLength(2);
    expect(m.params("data.subscribe")).toHaveLength(4);
    expect(m.params("data.unsubscribe")).toEqual([
      { subscriptionId: "dsub-1" },
      { subscriptionId: "dsub-2" },
    ]);

    await m.open({ id: "test.empty" });
    expect(m.shown().map((c) => [c.state, c.message])).toEqual([["empty", "Nothing due"]]);
    expect(m.params("data.unsubscribe")).toHaveLength(4);

    await m.host.invoke("desk.views.close");
    await m.settle();
    expect(m.params("data.unsubscribe")).toEqual(
      ["dsub-1", "dsub-2", "dsub-3", "dsub-4", "dsub-5"].map((subscriptionId) => ({
        subscriptionId,
      })),
    );
    expect(m.host.visible).toBe(false);
    expect(m.view.drawn.at(-1)).toBeNull();

    // A view removed while it is open closes with a notice.
    await m.open({ id: "desk.today" });
    await m.host.call("view.remove", { id: "desk.today", scope: VIEWS });
    await m.settle();
    expect(m.params("data.unsubscribe")).toHaveLength(7);
    expect(m.view.notices.at(-1)).toBe("Today, again was removed.");
  });

  it("desk.views.open-original fails until shell.open is served", async () => {
    const m = await mount({ views: [today] });
    await expect(
      m.host.invoke("desk.views.open-original", { url: "https://endue.ai" }),
    ).rejects.toThrow("failed: shell.open is not served yet");
    await m.engine.link("https://endue.ai/docs");
    await m.settle();
    expect(m.host.ran.at(-1)).toEqual({
      name: "desk.views.open-original",
      args: { url: "https://endue.ai/docs" },
    });
    expect(m.view.toasts).toEqual(["Desk can't open the original app yet"]);
  });
});
