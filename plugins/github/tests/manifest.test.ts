// desk.github is data only: an http connector (specs/connector/v0, ADR 0106) the core runs. These tests
// read its manifest against the specs and walk its mapping over the fixture search pages the core's
// tests serve (crates/desk-core/tests/connectors_http.rs runs the requests themselves).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { HttpRead, HttpValue, PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/github/plugin.json")) as PluginManifest;
const page = (name: string) =>
  readJson(join(import.meta.dirname, "fixtures", name)) as { items: Record<string, unknown>[] };

function validator(target: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".schema.json")))
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(target);
  if (!validate) throw new Error(`cannot compile ${target}`);
  return validate;
}

/** RFC 6901: the value at `pointer` in `value`, or undefined. */
function at(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let here = value;
  for (const token of pointer.slice(1).split("/")) {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (here === null || typeof here !== "object") return undefined;
    here = (here as Record<string, unknown>)[key];
  }
  return here;
}

/** One field's value as the binding reads it (the README's rules), undefined for none. */
function read(record: unknown, value: HttpValue): unknown {
  if (typeof value === "string") return at(record, value) ?? undefined;
  if ("const" in value) return value.const;
  const rule = value as HttpRead;
  let found = at(record, rule.pointer);
  if (typeof found === "string" && rule.after !== undefined) {
    const cut = found.lastIndexOf(rule.after);
    found = cut < 0 ? undefined : found.slice(cut + rule.after.length);
  }
  if (found !== undefined && found !== null && rule.values !== undefined)
    found = rule.values[String(found)];
  return found ?? rule.default ?? undefined;
}

const records = () =>
  ["assigned-1.json", "assigned-2.json", "review-requested.json", "authored.json"].flatMap(
    (name) => page(name).items,
  );

describe("desk.github", () => {
  it("is an http connector without an entry, its token a secret setting sent only to GitHub", () => {
    const plugin = manifest();
    const validate = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json");
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.github", name: "GitHub", kind: "connector" });
    expect(plugin.entry).toBeUndefined();
    const connector = plugin.connector;
    expect(connector?.binding).toBe("http");
    expect(connector?.auth).toEqual({ kind: "token", title: "Personal access token" });
    expect(connector?.http?.baseUrl).toBe("https://api.github.com");
    expect(connector?.http?.auth).toEqual({ setting: "token" });
    expect(connector?.instanceSettings?.token).toMatchObject({ secret: true, required: true });
    expect(plugin.permissions).toEqual([{ permission: "net:fetch", hosts: ["api.github.com"] }]);
    expect(connector?.resources).toEqual([{ kind: "task" }]);
  });

  it("asks for the issues assigned to you, the reviews you owe and your own pull requests", () => {
    const requests = manifest().connector?.http?.requests ?? [];
    expect(requests.map((r) => r.query?.q)).toEqual([
      "is:open assignee:@me",
      "is:open is:pr review-requested:@me",
      "is:open is:pr author:@me",
    ]);
    for (const request of requests)
      expect(request).toMatchObject({
        path: "/search/issues",
        items: "/items",
        pagination: { next: "link" },
        map: "issue",
      });
  });

  it("maps every fixture record into a task item that fits specs/item/v0", () => {
    const map = manifest().connector?.http?.maps?.issue;
    if (!map) throw new Error("no issue map");
    expect(map.kind).toBe("task");
    const validate = validator("https://endue.ai/specs/item/v0/item.schema.json#/$defs/TaskItem");
    const items = records().map((record) => {
      const item: Record<string, unknown> = {
        kind: map.kind,
        source: { connector: "desk.github", instance: "work" },
      };
      for (const [field, value] of Object.entries(map.fields)) {
        const found = read(record, value);
        if (found !== undefined && found !== null) item[field] = found;
      }
      return item;
    });
    for (const item of items) expect(validate(item), JSON.stringify(validate.errors)).toBe(true);
    const calendar = items.find((i) => i.id === "I_kwDOFixture012");
    expect(calendar).toMatchObject({
      title: "Calendar drops all-day events",
      status: "open",
      project: "acme/garage",
      due: "2026-10-30T07:00:00Z",
      deepLink: "https://github.com/acme/garage/issues/12",
    });
    expect(new Set(items.map((i) => i.id)).size).toBe(5);
  });
});
