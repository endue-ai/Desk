// plugin.json as specs/plugin/v0 reads it: a UI plugin off until opened, one centre surface, its
// three commands, and no permission of its own: each computer's net:connect is asked for at its
// first connection. The page loads the vendored noVNC from its own folder.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/screens");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
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

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin, off until opened, with one centre surface and no permission of its own", () => {
    const validate = manifestValidator();
    const screens = manifest();
    expect(validate(screens), JSON.stringify(validate.errors)).toBe(true);
    expect(screens).toMatchObject({
      id: "endue.screens",
      name: "Screen Sharing",
      kind: "ui",
      autoload: true,
    });
    expect(existsSync(join(folder, screens.entry ?? "missing"))).toBe(true);
    expect(screens.surfaces).toEqual([
      { id: "main", title: "Screen Sharing", placement: "center" },
    ]);
    expect(screens.permissions).toBeUndefined();
  });

  it("contributes open, connect and disconnect under its own id", () => {
    const commands = manifest().contributes?.commands ?? [];
    expect(commands.map((c) => c.id)).toEqual([
      "endue.screens.open",
      "endue.screens.connect",
      "endue.screens.disconnect",
    ]);
    expect(commands[0]).toMatchObject({
      runs: { command: "desk.plugins.open", args: { plugin: "endue.screens" } },
    });
  });

  it("the page loads its script, and main.js the vendored RFB from the plugin's folder", () => {
    const html = readFileSync(join(folder, "ui/index.html"), "utf8");
    expect(html).toContain('<script type="module" src="./main.js"></script>');
    const main = readFileSync(join(folder, "ui/main.js"), "utf8");
    expect(main).toContain('from "./vendor/novnc/core/rfb.js"');
    expect(existsSync(join(folder, "ui/vendor/novnc/core/rfb.js"))).toBe(true);
    expect(readFileSync(join(folder, "ui/vendor/novnc/VERSIONS"), "utf8")).toBe(
      "@novnc/novnc 1.7.0\n",
    );
  });
});
