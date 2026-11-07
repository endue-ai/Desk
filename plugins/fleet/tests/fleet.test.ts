// desk.fleet, the control center for agents (ADR 0100): a policy plugin whose one command opens a
// universal kanban over every run (kind run), the runs waiting for approval first, with Approve,
// Deny and Stop on each card. The view is checked against specs/view/v0 and drawn over fixture runs.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { Item, PluginManifest, UniversalView } from "../../../packages/bridge/src/index";
import { entriesFromItems, fillArgs } from "../../../packages/plugin-sdk/src/index";
import { kanbanOf, rowsOf } from "../../../packages/ui/src/universal/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/fleet/plugin.json")) as PluginManifest;

function validator(id: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0", "agent/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`cannot compile ${id}`);
  return validate;
}

/** The board: the universal view desk.fleet.open opens. */
function board(): UniversalView {
  const open = manifest().contributes?.commands?.find((c) => c.id === "desk.fleet.open");
  expect(open?.runs?.command).toBe("desk.universal.open");
  const args = open?.runs?.args as { view: UniversalView } | undefined;
  if (!args) throw new Error("desk.fleet.open opens no view");
  return args.view;
}

const source = { connector: "desk.agents", instance: "default" };
const run = (id: string, state: string, extra: Partial<Item> = {}): Item =>
  ({
    kind: "run",
    id,
    source,
    title: `Run ${id}`,
    updatedAt: "2026-11-05T09:30:00Z",
    agent: "eris",
    state,
    startedAt: "2026-11-05T09:30:00Z",
    ...extra,
  }) as Item;

const RUNS: Item[] = [
  run("run-1", "done", { result: "2 new messages", endedAt: "2026-11-05T09:30:05Z" }),
  run("run-2", "waiting", { approval: "a-7", command: "endue.local-agents.work" }),
  run("r9", "running", {
    agent: "endue.local-agents/claude",
    source: { connector: "endue.local-agents", instance: "default" },
  }),
  run("run-3", "failed", { result: "the index is gone" }),
];

describe("desk.fleet", () => {
  it("is a policy plugin whose command opens a valid universal view of runs", () => {
    const plugin = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json");
    expect(plugin(manifest()), JSON.stringify(plugin.errors)).toBe(true);
    expect(manifest()).toMatchObject({ id: "desk.fleet", kind: "policy" });
    const view = validator(
      "https://endue.ai/specs/view/v0/universal.schema.json#/$defs/UniversalView",
    );
    expect(view(board()), JSON.stringify(view.errors)).toBe(true);
    expect(board().source).toEqual({
      items: { kinds: ["run"], sort: [{ field: "startedAt", dir: "desc" }], limit: 500 },
    });
  });

  it("puts what waits for approval first, then what runs, what finished and what failed", () => {
    const view = board();
    const columns = kanbanOf(
      rowsOf({ entries: entriesFromItems(RUNS) }, view.map ? { map: view.map } : {}),
      view.options?.groups ?? [],
    );
    expect(columns.map((c) => [c.group, c.rows.map((r) => r.id)])).toEqual([
      ["waiting", ["run-2"]],
      ["running", ["r9"]],
      ["done", ["run-1"]],
      ["failed", ["run-3"]],
      ["cancelled", []],
    ]);
    const done = columns[2]?.rows[0];
    expect([done?.author, done?.detail]).toEqual(["eris", "2 new messages"]);
  });

  it("approves, denies and stops through the permissions plugin with the card's own args", () => {
    const [, waiting, local] = entriesFromItems(RUNS);
    const actions = board().actions ?? [];
    expect(actions.map((a) => [a.title, a.command])).toEqual([
      ["Approve", "endue.permissions.approve"],
      ["Deny", "endue.permissions.deny"],
      ["Stop", "endue.permissions.cancel-run"],
    ]);
    const args = (i: number, entry: Record<string, unknown> | undefined) =>
      fillArgs(actions[i]?.args, entry ?? {});
    expect(args(0, waiting)).toEqual({ approval: "a-7" });
    expect(args(1, waiting)).toEqual({ approval: "a-7" });
    expect(args(2, local)).toEqual({
      run: "r9",
      source: { connector: "endue.local-agents", instance: "default" },
    });
  });
});
