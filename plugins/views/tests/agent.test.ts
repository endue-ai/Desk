import { expect, it, vi } from "vitest";
import { FIXTURE_CONNECTOR, type UniversalPage } from "../../../packages/bridge/src/index";
import { CONNECTORS, manifest, mount, VIEWS, vector } from "./harness";

const today = vector("view-today");

it("offers saved view listing, opening and item reads to agents", () => {
  const commands = manifest().contributes?.commands ?? [];
  for (const id of ["desk.views.list", "desk.views.read"])
    expect(
      commands.find((command) => command.id === id),
      id,
    ).toMatchObject({
      agent: true,
      readOnly: true,
      description: expect.any(String),
    });
  expect(commands.find((command) => command.id === "desk.views.open")).toMatchObject({
    agent: true,
  });
});

it("lists saved views and reads Today's item sections without showing or subscribing", async () => {
  const m = await mount({ views: [today] });
  expect(await m.host.command("desk.views.list")).toMatchObject({
    views: [expect.objectContaining({ id: "desk.today", title: "Today" })],
  });
  expect(await m.host.command("desk.views.read", { id: today.id })).toMatchObject({
    id: "desk.today",
    sections: [
      {
        title: "Schedule",
        entries: expect.arrayContaining([expect.objectContaining({ id: "ev-standup" })]),
      },
      {
        title: "To do",
        entries: expect.arrayContaining([expect.objectContaining({ id: "task-report" })]),
      },
    ],
  });
  expect(m.view.drawn).toEqual([]);
  expect(m.params("data.subscribe")).toEqual([]);
  expect(m.host.visible).toBeUndefined();
});

it("remembers only the person's saved-view account selections across openings", async () => {
  const pick = vi.fn(() => `${FIXTURE_CONNECTOR}/work`);
  const m = await mount({ views: [today], commands: { "desk.palette.pick": pick } });
  await m.host.call("connector.connect", {
    connector: FIXTURE_CONNECTOR,
    instance: "work",
    title: "Work",
    scope: CONNECTORS,
  });
  await m.open({ id: today.id });
  expect(pick).toHaveBeenCalledTimes(2);
  await m.open({ id: today.id, bindings: { calendar: `${FIXTURE_CONNECTOR}/default` } });
  await m.host.command("desk.views.read", { id: today.id });
  await m.open({ id: today.id });
  expect(pick).toHaveBeenCalledTimes(2);
  const queries = m.params("data.query") as Array<{ query: { sources: string[] } }>;
  expect(queries.slice(-2).map(({ query }) => query.sources)).toEqual([
    [`${FIXTURE_CONNECTOR}/work`],
    [`${FIXTURE_CONNECTOR}/work`],
  ]);
  expect(m.params("store.set")).toHaveLength(1);
});

it("recovers a saved account when the view engine starts again", async () => {
  const data = new Map<string, unknown>();
  const pick = vi.fn(() => `${FIXTURE_CONNECTOR}/work`);
  const open = async () => {
    const m = await mount({
      views: [today],
      commands: { "desk.palette.pick": pick },
      handlers: {
        "store.get": ({ key }) => (data.has(key) ? { value: data.get(key) } : {}),
        "store.set": ({ key, value }) => {
          data.set(key, structuredClone(value));
          return {};
        },
      },
    });
    await m.host.call("connector.connect", {
      connector: FIXTURE_CONNECTOR,
      instance: "work",
      title: "Work",
      scope: CONNECTORS,
    });
    await m.open({ id: today.id });
    return m;
  };
  await open();
  const next = await open();
  expect(pick).toHaveBeenCalledTimes(2);
  expect(next.params("data.query")).toMatchObject([
    { query: { sources: [`${FIXTURE_CONNECTOR}/work`] } },
    { query: { sources: [`${FIXTURE_CONNECTOR}/work`] } },
  ]);
});

it("reads only item-source sections of a Universal page with the view's parameters", async () => {
  const run = vi.fn(() => ({ entries: [{ title: "Never load this source" }] }));
  const m = await mount({ commands: { "example.source.read": run } });
  const saved: UniversalPage = {
    id: "example.item-page",
    title: "Tasks",
    params: { status: { kind: "string", default: "done" } },
    sections: [
      {
        title: "Selected tasks",
        type: "list",
        source: {
          items: {
            kinds: ["task"],
            where: [{ field: "status", op: "eq", value: "{params.status}" }],
          },
        },
      },
      { title: "Other source", type: "list", source: { command: "example.source.read" } },
    ],
  };
  await m.host.call("view.save", { view: saved, scope: VIEWS });
  expect(
    await m.host.command("desk.views.read", { id: saved.id, params: { status: "open" } }),
  ).toMatchObject({
    id: saved.id,
    sections: [
      {
        title: "Selected tasks",
        entries: expect.arrayContaining([expect.objectContaining({ id: "task-report" })]),
      },
      { title: "Other source", entries: [], state: "unsupported" },
    ],
  });
  expect(m.params("data.query")).toMatchObject([
    { query: { where: [{ field: "status", op: "eq", value: "open" }] } },
  ]);
  expect(run).not.toHaveBeenCalled();
  expect(m.host.visible).toBeUndefined();
});

it("reads bound data without copying a connector's raw fields", async () => {
  const m = await mount({ views: [today] });
  m.host.upsert({
    kind: "task",
    id: "visible-task",
    source: { connector: FIXTURE_CONNECTOR, instance: "default" },
    title: "Visible task",
    status: "open",
    due: "2026-10-30T18:00:00+09:00",
    updatedAt: "2026-10-30T08:59:00+09:00",
    raw: { internal: "Only in the connector record" },
  });
  const read = (await m.host.command("desk.views.read", { id: today.id })) as {
    sections: Array<{ entries: Array<Record<string, unknown>> }>;
  };
  const entry = read.sections
    .flatMap(({ entries }) => entries)
    .find(({ id }) => id === "visible-task");
  expect(entry).toMatchObject({ title: "Visible task" });
  expect(entry).not.toHaveProperty("raw");
});
