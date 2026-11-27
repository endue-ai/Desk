import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

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

describe("plugin.json", () => {
  const manifest = readJson(join(root, "plugins/browser/plugin.json")) as PluginManifest;

  it("is a UI plugin with a centre surface, off until the person opens it", () => {
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "endue.browser",
      name: "Browser",
      kind: "ui",
      entry: "ui/index.html",
      autoload: true,
      surfaces: [{ id: "main", title: "Browser", placement: "center" }],
    });
  });

  it("asks to show web pages and to read and operate them, and nothing more", () => {
    expect(manifest.permissions).toEqual([
      { permission: "web:browse" },
      { permission: "web:control" },
    ]);
  });

  it("offers its commands under its own id, and the settings its page reads", () => {
    const ids = manifest.contributes?.commands?.map((c) => c.id);
    expect(ids).toEqual([
      "endue.browser.open",
      "endue.browser.go",
      "endue.browser.reload",
      "endue.browser.read",
      "endue.browser.scroll",
      "endue.browser.click",
      "endue.browser.type",
      "endue.browser.key",
      "endue.browser.select",
      "endue.browser.navigate-key",
      "endue.browser.follow",
      "endue.browser.find",
      "endue.browser.zoom",
      "endue.browser.back",
      "endue.browser.forward",
      "endue.browser.stop",
    ]);
    expect(Object.keys(manifest.contributes?.settings ?? {})).toEqual([
      "endue.browser.home",
      "endue.browser.search",
    ]);
  });

  it("offers the assistant what a person does in a browser, each with what it does", () => {
    const commands = manifest.contributes?.commands ?? [];
    const tools = commands.filter((c) => c.agent);
    expect(tools.map((c) => c.id.replace("endue.browser.", ""))).toEqual([
      "go",
      "reload",
      "read",
      "scroll",
      "click",
      "type",
      "key",
      "select",
      "navigate-key",
      "follow",
      "find",
      "zoom",
      "back",
      "forward",
      "stop",
    ]);
    for (const tool of tools) expect(tool.description, tool.id).toBeTruthy();
    // Reading changes nothing; what may send something off waits for the person (ADR 0078).
    const flagged = (flag: "readOnly" | "irreversible") =>
      tools.filter((c) => c[flag]).map((c) => c.id.replace("endue.browser.", ""));
    expect(flagged("readOnly")).toEqual(["read"]);
    expect(flagged("irreversible")).toEqual(["click", "key"]);
  });
});
