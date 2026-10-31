import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/data");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

/** The 25 patterns of the requirement and `.env` itself, which `*.env` covers only by luck. */
const PATTERNS = [
  "*.json",
  "*.jsonc",
  "*.json5",
  "*.jsonl",
  "*.ndjson",
  "*.yaml",
  "*.yml",
  "*.toml",
  "*.xml",
  "*.xsd",
  "*.xsl",
  "*.xslt",
  "*.plist",
  "*.ini",
  "*.cfg",
  "*.conf",
  "*.properties",
  "*.env",
  ".env",
  ".env.*",
  "*.hcl",
  "*.tf",
  "*.tfvars",
  "*.msgpack",
  "*.bson",
  "*.cbor",
];

describe("plugin.json", () => {
  it("is a UI plugin with one centre surface and the 26 file patterns", () => {
    const validate = manifestValidator();
    const data = manifest();
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
    expect(data.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, data.entry ?? "missing"))).toBe(true);
    expect(data).toMatchObject({ id: "endue.data", name: "Data", kind: "ui" });
    expect(data.surfaces).toEqual([{ id: "main", title: "Data", placement: "center" }]);
    expect(data.contributes?.files).toEqual(
      PATTERNS.map((pattern) => ({ pattern, plugin: "endue.data" })),
    );
    expect(data.contributes?.files).toHaveLength(26);
  });

  it("declares no paths of its own: every file is asked for when it opens", () => {
    const data = manifest();
    expect(data.permissions).toEqual([
      { permission: "cmd:invoke", ids: ["desk.files.changed", "desk.palette.pick"] },
    ]);
    const kinds = (data.permissions ?? []).map((p) => p.permission);
    expect(kinds).not.toContain("fs:read");
    expect(kinds).not.toContain("fs:write");
  });

  it("has the mask-secrets setting, on by default", () => {
    expect(manifest().contributes?.settings?.["endue.data.mask-secrets"]).toMatchObject({
      kind: "boolean",
      default: true,
    });
  });

  it("the desk's opener rule picks data for every pattern, .env and .env.local included", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner.
    const owner = "endue.data";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    const names = [
      "package.json",
      "settings.jsonc",
      "config.json5",
      "events.jsonl",
      "events.ndjson",
      "docker-compose.yaml",
      "ci.yml",
      "Cargo.toml",
      "pom.xml",
      "schema.xsd",
      "style.xsl",
      "style.xslt",
      "Info.plist",
      "php.ini",
      "setup.cfg",
      "nginx.conf",
      "app.properties",
      "prod.env",
      ".env",
      ".env.local",
      "config.hcl",
      "main.tf",
      "prod.tfvars",
      "dump.msgpack",
      "dump.bson",
      "dump.cbor",
    ];
    for (const name of names) expect(opener(rules, `~/data/${name}`), name).toBe("endue.data");
    expect(opener(rules, "~/data/notes.md")).toBeUndefined();
    expect(opener(rules, "~/data/environment")).toBeUndefined();
  });
});
