import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest, ThemePackage } from "@endue-ai/bridge";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { colors, tokens as desk } from "../../ui/src/index";
import { compileTheme, gate } from "../../ui/src/theme/index";
import { main } from "./cli";
import { defaultId, defaultName } from "./names";
import { renderPlugin } from "./template";

const root = join(import.meta.dirname, "../../..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");
const SCHEMES = ["light", "dark"] as const;

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const folder of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", folder);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(JSON.parse(read(join("specs", folder, name))) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

/** The endue theme's palette for a scheme, which the desk gates a theme over. */
function endue(scheme: (typeof SCHEMES)[number]): Record<string, string> {
  const own = JSON.parse(read("plugins/theme/plugin.json")) as PluginManifest;
  return { ...own.contributes?.themes?.find((t) => t.id === `desk.theme.${scheme}`)?.tokens };
}

const render = (options: { desk?: string } = {}) =>
  renderPlugin({ id: "example.my-theme", name: "My theme", kind: "theme", ...options });
const manifestOf = (files: Record<string, string>) =>
  JSON.parse(files["plugin.json"] ?? "null") as PluginManifest;
const themeOf = (files: Record<string, string>) => manifestOf(files).theme as ThemePackage;

describe("renderPlugin with kind theme", () => {
  it("writes a theme manifest that specs/plugin v0 accepts, with a licence and no code", () => {
    const manifest = manifestOf(render());
    const validate = manifestValidator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "example.my-theme",
      name: "My theme",
      version: "0.1.0",
      kind: "theme",
    });
    for (const field of ["entry", "permissions", "surfaces", "contributes", "autoload"])
      expect(manifest, field).not.toHaveProperty(field);
    expect(themeOf(render()).license).toMatch(/\S/);
  });

  it("keeps a description when one is given", () => {
    const files = renderPlugin({
      id: "example.dusk",
      name: "Dusk",
      kind: "theme",
      description: "Dusk.",
    });
    expect(manifestOf(files)).toMatchObject({ kind: "theme", description: "Dusk." });
    expect(manifestValidator()(manifestOf(files))).toBe(true);
  });

  it.each(SCHEMES)("sets every role colour for %s", (scheme) => {
    const palette = themeOf(render())[scheme]?.colors ?? {};
    const roles = Object.keys(colors).filter((name) => name !== "accent");
    expect(Object.keys(palette).sort()).toEqual(roles.sort());
  });

  it.each(SCHEMES)("compiles for %s and passes the gate with no fixes", (scheme) => {
    const compiled = compileTheme(themeOf(render()), scheme);
    expect(compiled.hasScheme).toBe(true);
    const base = endue(scheme);
    expect(gate({ ...base, ...compiled.tokens }, { fallback: base }).fixes).toEqual([]);
    // Its own palette is whole: gated alone, it needs no fix either.
    expect(gate(compiled.tokens).fixes).toEqual([]);
  });

  it.each(SCHEMES)("writes every other layer for %s at the desk's default", (scheme) => {
    const theme = themeOf(render());
    expect(theme.type).toBeDefined();
    expect(theme.shape).toBeDefined();
    expect(theme.motion).toBeDefined();
    expect(theme[scheme]?.material).toBeDefined();
    const compiled = compileTheme(theme, scheme).tokens;
    const palette = new Set(Object.keys(theme[scheme]?.colors ?? {}));
    const layers = Object.entries(compiled).filter(([name]) => !palette.has(name));
    expect(layers.length).toBeGreaterThan(10);
    for (const [name, value] of layers)
      expect(value, name).toBe((desk as Record<string, string>)[name]);
  });

  it("comments the palette and the layers in the README", () => {
    const readme = render()["README.md"] ?? "";
    expect(readme).toMatch(/^# My theme\n/);
    expect(readme).toContain("`example.my-theme`");
    for (const name of Object.keys(themeOf(render()).dark?.colors ?? {})) {
      const token = name.replace(/\d+$/, "");
      expect(readme, name).toMatch(new RegExp(`\`${token}\\w*\``));
    }
    for (const layer of ["type", "shape", "motion", "material", "backdrop", "terminal"])
      expect(readme, layer).toContain(`\`${layer}\``);
    expect(readme).toContain("theme apply example.my-theme");
    expect(readme).toContain(".desk-theme");
  });

  it("lays out the manifest, a README and the test examples/plugin-hello-theme carries", () => {
    const files = render();
    expect(Object.keys(files).sort()).toEqual(["README.md", "plugin.json", "tests/theme.test.ts"]);
    expect(files["tests/theme.test.ts"]).toBe(
      read("examples/plugin-hello-theme/tests/theme.test.ts"),
    );
  });

  it("points its test at the Desk repository it was made beside", () => {
    const test = render({ desk: "../Desk" })["tests/theme.test.ts"] ?? "";
    expect(test).toContain('from "../../Desk/packages/ui/src/theme/index"');
    expect(test).toContain('from "../../Desk/packages/bridge/src/index"');
    expect(test).toContain('resolve(import.meta.dirname, "../../Desk")');
    expect(test).not.toContain("../../../");
  });
});

describe("create-plugin --kind theme", () => {
  it("names the theme after its folder as names.ts does and says how to check and choose it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "create-plugin-theme-"));
    const out: string[] = [];
    const err: string[] = [];
    const io = { cwd, out: (l: string) => out.push(l), err: (l: string) => err.push(l) };
    expect(await main(["My Theme", "--kind", "theme"], io)).toBe(0);
    const dir = join(cwd, "My Theme");
    const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8")) as PluginManifest;
    expect(manifest).toMatchObject({
      id: defaultId("My Theme"),
      name: defaultName("My Theme"),
      kind: "theme",
    });
    expect(manifest.id).toBe("local.my-theme");
    expect(readdirSync(join(dir, "tests"))).toEqual(["theme.test.ts"]);
    expect(err).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("plugin validate");
    expect(text).toContain("vitest run --root");
    expect(text).toContain("DESK_DEV_PLUGINS=");
    expect(text).toContain("theme apply local.my-theme");
    expect(text).not.toContain("cargo build");
  });

  it("lists the theme kind in its usage", async () => {
    const out: string[] = [];
    const io = { cwd: tmpdir(), out: (l: string) => out.push(l), err: () => {} };
    expect(await main(["--help"], io)).toBe(0);
    expect(out.join("\n")).toContain("--kind ui|connector|theme");
  });
});
