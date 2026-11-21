// What the SQL problems bind names against (PG-30, ADR 0294): the schema cache's answers turned into
// the parser's model, only what the cache holds, and the editor's context from the console on
// screen, which asks the server nothing.
import { describe, expect, it } from "vitest";
import { problemModel } from "../ui/diagnose/model.js";
import type { Node } from "../ui/explorer.js";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, shop } from "./pg-catalog";

type State = { name: string; system: boolean; chosen: boolean; held: boolean; kept: boolean };

/** A cache view as schema-cache/view.js answers it, over a few schemas. */
function cacheView(readAt: number | null, states: State[]) {
  const objects: Record<string, Array<{ name: string; kind: string; detail?: string }>> = {
    public: [
      { name: "people", kind: "table" },
      { name: "events", kind: "table", detail: "partitioned" },
      { name: "people_id_seq", kind: "sequence" },
      { name: "big", kind: "view" },
      { name: "touch()", kind: "function" },
    ],
    pg_catalog: [{ name: "pg_class", kind: "table" }],
  };
  const columns: Record<string, Array<{ name: string; type: string }>> = {
    "public.people": [
      { name: "id", type: "integer" },
      { name: "name", type: "text" },
    ],
    "public.events": [{ name: "at", type: "date" }],
    "public.big": [{ name: "id", type: "integer" }],
    "pg_catalog.pg_class": [{ name: "relname", type: "name" }],
  };
  const held = (s: string) => states.find((x) => x.name === s)?.held ?? false;
  return {
    readAt,
    all: () => states,
    schemas: () => states.filter((s) => s.held).map((s) => s.name),
    held,
    objects: (s: string) => (held(s) ? (objects[s] ?? []) : undefined),
    columns: (s: string, t: string) => (held(s) ? (columns[`${s}.${t}`] ?? []) : undefined),
    routines: (s: string) =>
      held(s) && s === "public"
        ? [{ name: "touch", args: "", kind: "function", result: "trigger" }]
        : held(s)
          ? []
          : undefined,
  };
}

const state = (name: string, held: boolean, system = false): State => ({
  name,
  system,
  chosen: held,
  held,
  kept: held,
});

/** The editor's context action, as the view's `act` reaches it. */
const contextOf = (m: Mounted) =>
  (m.app as unknown as { problemsContext(): Promise<unknown> }).problemsContext();
const row = (m: Mounted, label: string) => m.view.trees.at(-1)?.find((r) => r.label === label);
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}

describe("what SQL problems bind against", () => {
  it("the model is what the cache holds and only that", () => {
    const states = [
      state("information_schema", false, true),
      state("pg_catalog", false, true),
      state("public", true),
      state("sales", false),
    ];
    const model = problemModel("c-1", cacheView(5, states) as never);
    expect(model).toEqual({
      schemas: [
        {
          name: "public",
          relations: [
            {
              name: "people",
              kind: "table",
              columns: [
                { name: "id", type: "integer" },
                { name: "name", type: "text" },
              ],
            },
            {
              name: "events",
              kind: "table",
              columns: [{ name: "at", type: "date" }],
              partitioned: true,
            },
            { name: "people_id_seq", kind: "sequence" },
            { name: "big", kind: "view", columns: [{ name: "id", type: "integer" }] },
          ],
          routines: [{ name: "touch", kind: "function", args: "", result: "trigger" }],
        },
        { name: "sales" },
      ],
    });
    // Kept while the cache does not change; a new read is a new model.
    expect(problemModel("c-1", cacheView(5, states) as never)).toBe(model);
    expect(problemModel("c-1", cacheView(6, states) as never)).not.toBe(model);
    // A system schema the person chose to read is held and in the model.
    const chosen = problemModel("c-2", cacheView(5, [state("pg_catalog", true, true)]) as never);
    expect(chosen?.schemas.map((s) => s.name)).toEqual(["pg_catalog"]);
    // Nothing listed yet: no model, so no name is told missing.
    expect(problemModel("c-3", cacheView(null, []) as never)).toBeNull();
  });

  it("the editor's context comes from the console on screen, and typing sends nothing", async () => {
    const m = await mount({ store: { connections: SAVED }, script: catalogScript(() => shop()) });
    await m.host.command("endue.database.console", { connection: "Shop" });
    await until(m, () => row(m, "Shop"));
    m.app.toggle(row(m, "Shop") as Node, true);
    await until(m, () => row(m, "public"));
    const context = (await contextOf(m)) as {
      doc: string;
      model: { schemas: Array<{ name: string; relations?: Array<{ name: string }> }> };
      searchPath: string[];
      user: string;
      syntax: boolean;
      names: boolean;
    };
    expect(context).toMatchObject({
      doc: m.shown()?.id,
      searchPath: ["$user", "public"],
      user: "app",
      syntax: true,
      names: true,
    });
    expect(context.model.schemas.map((s) => s.name)).toEqual(["public", "sales"]);
    expect(context.model.schemas[0]?.relations?.map((r) => r.name)).toContain("people");
    const before = m.clients.spawned.length;
    for (let i = 0; i < 100; i++)
      expect(((await contextOf(m)) as typeof context).model).toBe(context.model);
    expect(m.clients.spawned.length).toBe(before);

    await m.host.command("endue.database.console", { connection: "Notes" });
    expect(await contextOf(m)).toBeUndefined();
  });

  it("each kind of problem has a setting", async () => {
    const m = await mount({
      store: { connections: SAVED },
      script: catalogScript(() => shop()),
      settings: { "problems-names": false },
    });
    await m.host.command("endue.database.console", { connection: "Shop" });
    expect(await contextOf(m)).toMatchObject({
      syntax: true,
      names: false,
      model: null,
    });
  });
});
