import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  BridgeClient,
  browserStub,
  fixtureItems,
  type ItemQuery,
  type PluginManifest,
  stubCommands,
  type View,
  type ViewComponent,
} from "../../../packages/bridge/src/index";
import { viewProblems } from "../../../packages/bridge/src/stub-views";

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

/** `{params.<name>}` in a binding's where values filled by hand, as desk.views fills them. */
function filled(binding: ItemQuery, params: Record<string, string>): ItemQuery {
  return {
    ...binding,
    where: (binding.where ?? []).map((condition) => ({
      ...condition,
      value: String(condition.value).replace(
        /^\{params\.([a-zA-Z0-9]+)\}$/,
        (_, name) => params[name] ?? "",
      ),
    })),
  };
}

describe("desk.item", () => {
  it("is a view plugin whose card binds the one item its params name", () => {
    const validate = manifestValidator();
    const plugin = manifest();
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.item", name: "Item", kind: "view" });
    expect(plugin.entry).toBeUndefined();
    const view = plugin.view as View;
    expect(view).toMatchObject({ id: "desk.item", version: "0.1.0" });
    expect(viewProblems(view)).toEqual([]);
    expect(view.requires).toBeUndefined();
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
    const card = view.layout as ViewComponent;
    expect(card.type).toBe("card");
    expect(card.binding).toEqual({
      where: [
        { field: "source.connector", op: "eq", value: "{params.connector}" },
        { field: "source.instance", op: "eq", value: "{params.instance}" },
        { field: "id", op: "eq", value: "{params.id}" },
      ],
      limit: 1,
    });
    expect(card.fields).toEqual([
      { value: "{title}" },
      { label: "Kind", value: "{kind}" },
      { label: "From", value: "{source.connector}" },
      { label: "Updated", value: "{updatedAt|relative}" },
      { value: "{body}" },
    ]);
    expect(card.empty).toBe("This item is not in Desk any more.");
  });

  it("with its params filled, the binding answers exactly that fixture item", async () => {
    const READER = "test.item";
    const core = stubCommands(() => {}, { grants: { [READER]: [{ permission: "data:read" }] } });
    const client = new BridgeClient(browserStub(core.handlers));
    // The same id in a second instance: only the instance the params name may answer.
    const groceries = fixtureItems().find((item) => item.id === "task-groceries");
    if (!groceries) throw new Error("no fixture task-groceries");
    core.upsert({ ...groceries, source: { connector: "desk.fixtures", instance: "work" } });

    const binding = (manifest().view?.layout as ViewComponent).binding ?? {};
    const query = filled(binding, {
      connector: "desk.fixtures",
      instance: "default",
      id: "task-groceries",
    });
    const { items } = await client.call(
      "data.query",
      { query, scope: { permission: "data:read" } },
      { caller: READER },
    );
    expect(items).toEqual([groceries]);

    const gone = filled(binding, {
      connector: "desk.fixtures",
      instance: "default",
      id: "task-gone",
    });
    const none = await client.call(
      "data.query",
      { query: gone, scope: { permission: "data:read" } },
      { caller: READER },
    );
    expect(none.items).toEqual([]);
  });
});
