import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { parse } from "yaml";
import type { TurnEvent } from "./brain.generated";
import { brainSchema } from "./brain.generated";
import type {
  BridgeMethodMap,
  BridgeRequest,
  ConnectorManifest,
  ConnectorStatus,
  DataReadPermission,
  FsReadResult,
  InitDocument,
  Item,
  ItemChange,
  ItemQuery,
  PluginManifest,
  View,
  ViewGetResult,
  ViewListResult,
  ViewNode,
} from "./generated";

type Schema = { $id: string; $defs: Record<string, unknown> };
type Vector = { file: string; valid: boolean; target: string; instance: unknown };

const specs = join(import.meta.dirname, "../../../specs");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function schemas(folder: string): Schema[] {
  return readdirSync(join(specs, folder))
    .filter((name) => name.endsWith(".schema.json"))
    .sort()
    .map((name) => readJson(join(specs, folder, name)) as Schema);
}

function vectors(spec: string): Vector[] {
  return (["valid", "invalid"] as const).flatMap((kind) => {
    const dir = join(specs, spec, "v0/vectors", kind);
    return readdirSync(dir)
      .sort()
      .map((name) => {
        const { target, instance } = readJson(join(dir, name)) as Omit<Vector, "file" | "valid">;
        return { file: `${spec}/${kind}/${name}`, valid: kind === "valid", target, instance };
      });
  });
}

function validatorFor(docs: Schema[]) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const doc of docs) ajv.addSchema(doc);
  return (target: string) => {
    const doc = docs.find((d) => target in d.$defs);
    if (!doc) throw new Error(`no definition named ${target}`);
    const validate = ajv.getSchema(`${doc.$id}#/$defs/${target}`);
    if (!validate) throw new Error(`cannot compile ${target}`);
    return validate;
  };
}

/** The plugin manifest and the specs it references, which reference it back: one set. */
const plugin = ["plugin/v0", "item/v0", "view/v0", "connector/v0"].flatMap(schemas);

const sets: Record<string, Schema[]> = {
  bridge: [...plugin, ...schemas("bridge/v0")],
  plugin,
  item: plugin,
  view: plugin,
  connector: plugin,
  init: [...plugin, ...schemas("init/v0")],
  brain: [brainSchema as Schema],
};

/** The template params a string reads ({params.days}); {{ and }} are literal braces. */
function paramsRead(text: string): string[] {
  const names: string[] = [];
  for (const m of text
    .replaceAll("{{", "")
    .replaceAll("}}", "")
    .matchAll(/\{([^}|]+)/g)) {
    const [head, name] = (m[1] ?? "").split(".");
    if (head === "params" && name) names.push(name);
  }
  return names;
}

/** Every string inside a JSON value, with its pointer. */
function strings(value: unknown, at: string): Array<[string, string]> {
  if (typeof value === "string") return [[at, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, v]) => strings(v, `${at}/${key}`));
}

/** The templates of one layout node and its children, with their pointers. */
function nodeTemplates(node: ViewNode, at: string): Array<[string, string]> {
  const out: Array<[string, string]> =
    node.title === undefined ? [] : [[`${at}/title`, node.title]];
  if ("children" in node) {
    node.children.forEach((child, i) => {
      out.push(...nodeTemplates(child, `${at}/children/${i}`));
    });
    return out;
  }
  for (const [i, c] of (node.binding?.where ?? []).entries())
    out.push(...strings(c.value, `${at}/binding/where/${i}/value`));
  for (const [i, field] of (node.fields ?? []).entries())
    out.push([`${at}/fields/${i}/value`, field.value]);
  for (const [i, action] of (node.actions ?? []).entries())
    out.push(...strings(action.args, `${at}/actions/${i}/args`));
  if (node.text !== undefined) out.push([`${at}/text`, node.text]);
  return out;
}

/** The $name sources of one layout node and its children, with their pointers. */
function nodeSources(node: ViewNode, at: string): Array<[string, string]> {
  if ("children" in node)
    return node.children.flatMap((child, i) => nodeSources(child, `${at}/children/${i}`));
  const sources = node.binding?.sources ?? [];
  return sources.map((source, i): [string, string] => [`${at}/binding/sources/${i}`, source]);
}

/** What view.schema.json cannot say: $names are requires entries, template params are declared. */
function viewProblems(view: View): string[] {
  const problems: string[] = [];
  const requires = Object.keys(view.requires ?? {});
  const params = Object.keys(view.params ?? {});
  for (const [at, source] of nodeSources(view.layout, "/layout"))
    if (source.startsWith("$") && !requires.includes(source.slice(1)))
      problems.push(`${at}: ${source} is not one of the view's requires`);
  const templates = [["/title", view.title], ...nodeTemplates(view.layout, "/layout")];
  for (const [at, text] of templates)
    for (const name of paramsRead(text ?? ""))
      if (!params.includes(name))
        problems.push(`${at}: {params.${name}} reads a param the view does not declare`);
  return problems.sort();
}

/** What plugin.schema.json cannot say: an inline view's names resolve, actions are commands. */
function manifestProblems(manifest: PluginManifest): string[] {
  const problems = manifest.view ? viewProblems(manifest.view).map((p) => `/view${p}`) : [];
  const commands = (manifest.contributes?.commands ?? []).map((c) => c.id);
  for (const [r, resource] of (manifest.connector?.resources ?? []).entries())
    for (const [a, id] of (resource.actions ?? []).entries())
      if (!commands.includes(id))
        problems.push(
          `/connector/resources/${r}/actions/${a}: ${id} is not in contributes.commands`,
        );
  return problems.sort();
}

function namesResolve(target: string, instance: unknown): boolean {
  if (target === "View") return viewProblems(instance as View).length === 0;
  if (target === "PluginManifest") return manifestProblems(instance as PluginManifest).length === 0;
  return true;
}

describe.each(Object.entries(sets))("%s vectors", (spec, docs) => {
  const validator = validatorFor(docs);
  for (const vector of vectors(spec)) {
    it(`${vector.file} is ${vector.valid ? "valid" : "invalid"}`, () => {
      const valid =
        validator(vector.target)(vector.instance) && namesResolve(vector.target, vector.instance);
      expect(valid).toBe(vector.valid);
    });
  }
});

describe("item, view and connector vectors are judged as their folders say", () => {
  it("each spec has five valid and five invalid vectors at least", () => {
    for (const spec of ["item", "view", "connector"]) {
      const all = vectors(spec);
      const valid = all.filter((v) => v.valid).length;
      expect(valid, spec).toBeGreaterThanOrEqual(5);
      expect(all.length - valid, spec).toBeGreaterThanOrEqual(5);
    }
  });

  it("the rules beyond the schemas name what does not resolve", () => {
    const view = {
      id: "example.mail",
      version: "0.1.0",
      title: "Last {params.days} days",
      requires: { calendar: { kinds: ["event"] } },
      layout: { type: "list", binding: { sources: ["$calendar", "$mail"] } },
    } satisfies View;
    expect(viewProblems(view)).toEqual([
      "/layout/binding/sources/1: $mail is not one of the view's requires",
      "/title: {params.days} reads a param the view does not declare",
    ]);
  });
});

describe("generated types agree with the schemas", () => {
  const bridge = validatorFor(sets.bridge ?? []);

  it("a typed fs.read request is valid", () => {
    const request = {
      id: 1,
      method: "fs.read",
      params: { path: "~/notes.md", scope: { permission: "fs:read", paths: ["~/**"] } },
    } satisfies BridgeRequest;
    expect(bridge("BridgeRequest")(request)).toBe(true);
  });

  it("a typed manifest is valid", () => {
    const manifest = {
      id: "example.hello-ui",
      version: "0.1.0",
      kind: "ui",
      entry: "ui/index.html",
      surfaces: [{ id: "main", placement: "center" }],
    } satisfies PluginManifest;
    expect(bridge("PluginManifest")(manifest)).toBe(true);
  });

  it("a typed item, query, change, view, connector block and status are valid", () => {
    const plugin = validatorFor(sets.plugin ?? []);
    const source = { connector: "endue.os-reminders", instance: "default" };
    const item = {
      id: "x-1",
      source,
      kind: "task",
      title: "Call the bank",
      updatedAt: "2026-10-30T09:00:00+09:00",
      status: "open",
    } satisfies Item;
    const query = {
      kinds: ["task"],
      where: [{ field: "status", op: "eq", value: "open" }],
    } satisfies ItemQuery;
    const change = { change: "removed", source, id: "x-1" } satisfies ItemChange;
    const view = {
      id: "example.tasks",
      version: "0.1.0",
      title: "Tasks",
      layout: { type: "list", binding: query, fields: [{ value: "{title}" }] },
    } satisfies View;
    const connector = {
      binding: "wasm",
      auth: { kind: "none" },
      resources: [{ kind: "task" }],
      sync: { mode: "pull" },
    } satisfies ConnectorManifest;
    const status = { state: "stale", lastSyncAt: "2026-10-30T08:00:00Z" } satisfies ConnectorStatus;
    const read = { permission: "data:read", kinds: ["task"] } satisfies DataReadPermission;
    expect(plugin("Item")(item)).toBe(true);
    expect(plugin("ItemChange")(change)).toBe(true);
    expect(plugin("View")(view)).toBe(true);
    expect(plugin("ConnectorManifest")(connector)).toBe(true);
    expect(plugin("ConnectorStatus")(status)).toBe(true);
    expect(plugin("Permission")(read)).toBe(true);
  });

  it("a typed view.list and view.get result say where each view came from", () => {
    const view = {
      id: "desk.today",
      version: "0.1.0",
      title: "Today",
      layout: { type: "list", binding: { kinds: ["event"] }, fields: [{ value: "{title}" }] },
    } satisfies View;
    const listed = {
      views: [
        {
          id: "desk.today",
          version: "0.1.0",
          title: "Today",
          source: "plugin",
          plugin: "desk.today",
        },
        { id: "example.notes", version: "0.1.0", title: "Notes", source: "file" },
      ],
    } satisfies ViewListResult;
    const got = { view, source: "plugin", plugin: "desk.today" } satisfies ViewGetResult;
    expect(bridge("ViewListResult")(listed)).toBe(true);
    expect(bridge("ViewGetResult")(got)).toBe(true);
  });

  it("a typed init document is valid", () => {
    const init = {
      profile: "focus",
      plugins: { disabled: ["endue.sidebar"] },
      settings: { "eris.voice": true },
      sync: { enabled: true },
    } satisfies InitDocument;
    expect(validatorFor(sets.init ?? [])("InitDocument")(init)).toBe(true);
  });

  it("the init.yaml template parses to the template vector", () => {
    const template = parse(readFileSync(join(specs, "init/v0/init.template.yaml"), "utf8"));
    const vector = readJson(join(specs, "init/v0/vectors/valid/template.json")) as Vector;
    expect(template).toEqual(vector.instance);
    expect(parse("# only a comment\n")).toBeNull();
  });

  it("a typed turn event is valid", () => {
    const event = { type: "text.delta", turnId: "t1", text: "hi" } satisfies TurnEvent;
    expect(validatorFor([brainSchema as Schema])("TurnEvent")(event)).toBe(true);
  });

  it("maps each method to its params and result", () => {
    expectTypeOf<BridgeMethodMap["fs.read"]["result"]>().toEqualTypeOf<FsReadResult>();
  });
});
