import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  fixtureItems,
  type PluginManifest,
  stubCommands,
  type UniversalView,
} from "../../../packages/bridge/src/index";
import { universalProblems } from "../../../packages/bridge/src/stub-universal";
import { fillQuery } from "../../../packages/plugin-sdk/src/universal-clock";
import { entriesFromItems } from "../../../packages/plugin-sdk/src/universal-load";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/item/plugin.json")) as PluginManifest;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

describe("desk.item", () => {
  it("is a view plugin whose detail view reads the one item its params name", () => {
    const validate = manifestValidator();
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.item", name: "Item", kind: "view" });
    expect(plugin.entry).toBeUndefined();
    const view = plugin.view as UniversalView;
    expect(view).toMatchObject({ id: "desk.item", title: "Item", type: "detail" });
    expect(universalProblems(view)).toEqual([]);
    expect(
      Object.entries(view.params ?? {}).map(([name, param]) => [
        name,
        param.kind,
        "default" in param,
      ]),
    ).toEqual([
      ["connector", "string", false],
      ["instance", "string", false],
      ["id", "string", false],
    ]);
    expect(view.source).toEqual({
      items: {
        where: [
          { field: "source.connector", op: "eq", value: "{params.connector}" },
          { field: "source.instance", op: "eq", value: "{params.instance}" },
          { field: "id", op: "eq", value: "{params.id}" },
        ],
        limit: 1,
      },
    });
    expect(view.empty).toBe("This item is not in Desk any more.");
  });

  it("with its params filled, the source answers exactly that fixture item, as one entry", async () => {
    const READER = "test.item";
    const core = stubCommands(() => {}, { grants: { [READER]: [{ permission: "data:read" }] } });
    const client = new BridgeClient(browserStub(core.handlers));
    // The same id in a second instance: only the instance the params name may answer.
    const groceries = fixtureItems().find((item) => item.id === "task-groceries");
    if (!groceries) throw new Error("no fixture task-groceries");
    core.upsert({ ...groceries, source: { connector: "desk.fixtures", instance: "work" } });

    const source = (manifest().view as UniversalView).source;
    if (!("items" in source)) throw new Error("an items source");
    const read = async (id: string) => {
      const params = { connector: "desk.fixtures", instance: "default", id };
      const query = fillQuery(source.items, { now: Date.now(), params });
      const scope = { permission: "data:read" } as const;
      return (await client.call("data.query", { query, scope }, { caller: READER })).items;
    };
    const items = await read("task-groceries");
    expect(items).toEqual([groceries]);
    // What the card showed (title, kind, source, update time, body) travels on the entry.
    expect(entriesFromItems(items)).toEqual([
      expect.objectContaining({
        id: "task-groceries",
        title: groceries.title,
        kind: "task",
        source: groceries.source,
        updatedAt: groceries.updatedAt,
      }),
    ]);
    expect(await read("task-gone")).toEqual([]);
  });
});
