import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  fixtureItems,
  type Item,
  type PaletteQuery,
  type PaletteResult,
  type PluginManifest,
} from "../../../packages/bridge/src/index";
import { actionOf, createAsker, itemResult, rows, searchItems } from "../ui/providers.js";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Ajv over specs/plugin/v0 and the specs it references, for one definition. */
function validator(target: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const base = target === "PluginManifest" ? "plugin" : "contributes";
  const id = `https://endue.ai/specs/plugin/v0/${base}.schema.json#/$defs/${target}`;
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`cannot compile ${target}`);
  return validate;
}

const ITEMS = { command: "desk.palette.items", title: "Items" };
const FILES = { command: "example.files.find", title: "Files" };
const MARKET = { command: "example.market.find", title: "Market" };

/** A result with one action, as a provider would answer it. */
const result = (id: string): PaletteResult => ({
  id,
  title: `Result ${id}`,
  actions: [{ command: "example.files.open", title: "Open", args: { id } }],
});

/** A run whose answers the test hands back one by one, by provider command and query. */
function deferred() {
  const asked: Array<[string, PaletteQuery]> = [];
  const pending = new Map<string, { resolve(v: unknown): void; reject(e: unknown): void }>();
  const run = (command: string, query: PaletteQuery) => {
    asked.push([command, query]);
    return new Promise((resolve, reject) =>
      pending.set(`${command} ${query.query}`, { resolve, reject }),
    );
  };
  const answer = async (command: string, query: string, value: unknown) => {
    pending.get(`${command} ${query}`)?.resolve(value);
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const fail = async (command: string, query: string) => {
    pending.get(`${command} ${query}`)?.reject(new Error("unknown_command"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { asked, run, answer, fail };
}

const item = (id: string): Item => {
  const found = fixtureItems().find((i) => i.id === id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};

describe("palette providers", () => {
  it("asks providers only for two characters or more, with the query and a limit of 5", () => {
    const { asked, run } = deferred();
    const asker = createAsker(run, () => {});
    asker.reset([ITEMS, FILES]);
    asker.ask("g");
    asker.ask("  g  ");
    expect(asked).toEqual([]);
    asker.ask(" gr ");
    expect(asked).toEqual([
      ["desk.palette.items", { query: "gr", limit: 5 }],
      ["example.files.find", { query: "gr", limit: 5 }],
    ]);
    // The same trimmed query is not asked again; a new one is.
    asker.ask("gr  ");
    expect(asked).toHaveLength(2);
    asker.ask("gro");
    expect(asked.slice(2).map(([, query]) => query)).toEqual([
      { query: "gro", limit: 5 },
      { query: "gro", limit: 5 },
    ]);
    asker.ask("g");
    expect(asked).toHaveLength(4);
  });

  it("turns an item into a result: Open in Desk first, Open the original second when it has a deepLink", async () => {
    const groceries = item("task-groceries");
    const open = {
      command: "desk.views.open",
      title: "Open in Desk",
      args: {
        id: "desk.item",
        params: { connector: "desk.fixtures", instance: "default", id: "task-groceries" },
      },
    };
    expect(itemResult(groceries)).toEqual({
      id: "desk.fixtures/default/task-groceries",
      title: "Buy groceries",
      detail: "Task · desk.fixtures",
      kind: "task",
      actions: [open],
    });
    const url = "https://tasks.example.com/task-groceries";
    const linked = itemResult({ ...groceries, deepLink: url });
    expect(linked.actions).toEqual([
      open,
      { command: "desk.views.open-original", title: "Open the original", args: { url } },
    ]);
    // Enter runs the first action, Mod+Enter the second when there is one.
    expect(actionOf(linked, false)).toEqual(open);
    expect(actionOf(linked, true)?.title).toBe("Open the original");
    expect(actionOf(itemResult(groceries), true)).toEqual(open);

    // desk.palette.items answers PaletteResults from data.query's text search.
    const asked: unknown[] = [];
    const answer = await searchItems({ query: "groceries", limit: 5 }, async (query: unknown) => {
      asked.push(query);
      return { items: [groceries] };
    });
    expect(asked).toEqual([{ text: "groceries", limit: 5 }]);
    expect(answer).toEqual({ results: [itemResult(groceries)] });
    const valid = validator("PaletteResults");
    expect(valid(answer), JSON.stringify(valid.errors)).toBe(true);
    expect(valid({ results: [linked] }), JSON.stringify(valid.errors)).toBe(true);
  });

  it("lists the commands first, then each provider's results under its title in the providers' order, leaving out empty groups", async () => {
    const { run, answer } = deferred();
    let changes = 0;
    const asker = createAsker(run, () => {
      changes += 1;
    });
    asker.reset([ITEMS, FILES, MARKET]);
    asker.ask("report");
    // Answers arrive out of order; the groups keep the providers' order.
    await answer("example.market.find", "report", { results: [result("m1")] });
    await answer("example.files.find", "report", { results: [] });
    await answer("desk.palette.items", "report", {
      results: ["a", "b", "c", "d", "e", "f"].map(result),
    });
    expect(changes).toBeGreaterThan(0);
    const groups = asker.groups();
    expect(groups.map((g: { title: string }) => g.title)).toEqual(["Items", "Market"]);
    // At most five results a group.
    expect(groups[0]?.results).toHaveLength(5);

    const commands = [{ id: "desk.theme.toggle", label: "Switch between light and dark" }];
    const listed = rows(commands, groups);
    expect(listed.map((row: { type: string }) => row.type)).toEqual([
      "command",
      ...Array(6).fill("result"),
    ]);
    expect(listed[0]).toEqual({ type: "command", entry: commands[0] });
    expect(listed[1]).toEqual({
      type: "result",
      provider: "desk.palette.items",
      group: "Items",
      result: result("a"),
    });
    expect(listed.at(-1)).toEqual({
      type: "result",
      provider: "example.market.find",
      group: "Market",
      result: result("m1"),
    });
  });

  it("drops an answer for a query that is no longer the one typed", async () => {
    const { run, answer } = deferred();
    const asker = createAsker(run, () => {});
    asker.reset([ITEMS]);
    asker.ask("gr");
    asker.ask("gro");
    await answer("desk.palette.items", "gr", { results: [result("old")] });
    expect(asker.groups()).toEqual([]);
    await answer("desk.palette.items", "gro", { results: [result("new")] });
    expect(asker.groups()).toEqual([
      { provider: "desk.palette.items", title: "Items", results: [result("new")] },
    ]);
    // Typing it shorter than two characters clears the groups, and a late answer stays out.
    asker.ask("g");
    expect(asker.groups()).toEqual([]);
  });

  it("leaves out a provider that failed or answered something that is not PaletteResults, and keeps the others", async () => {
    const { run, answer, fail } = deferred();
    const thrower = { command: "example.broken.find", title: "Broken" };
    const asker = createAsker(
      (command: string, query: PaletteQuery) => {
        if (command === thrower.command) throw new Error("no such command");
        return run(command, query);
      },
      () => {},
    );
    asker.reset([ITEMS, FILES, MARKET, thrower]);
    asker.ask("lunch");
    await fail("desk.palette.items", "lunch");
    await answer("example.files.find", "lunch", {
      results: [{ id: "x", title: "No actions", actions: [] }],
    });
    await answer("example.market.find", "lunch", { results: [result("m1")] });
    expect(asker.groups()).toEqual([
      { provider: "example.market.find", title: "Market", results: [result("m1")] },
    ]);
    asker.reset([FILES]);
    asker.ask("menu");
    await answer("example.files.find", "menu", "not results");
    expect(asker.groups()).toEqual([]);
  });

  it("desk.palette contributes its item provider and holds data:read", () => {
    const palette = readJson(join(root, "plugins/palette/plugin.json")) as PluginManifest;
    const valid = validator("PluginManifest");
    expect(valid(palette), JSON.stringify(valid.errors)).toBe(true);
    expect(palette.contributes?.paletteProviders).toEqual([ITEMS]);
    expect(palette.contributes?.commands).toContainEqual({
      id: "desk.palette.items",
      title: "Search items",
      keywords: ["search", "items", "find"],
    });
    expect(palette.permissions).toEqual([
      { permission: "cmd:invoke", ids: ["*"] },
      { permission: "data:read" },
    ]);
  });
});
