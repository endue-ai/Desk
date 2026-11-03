import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/explorer");
const pluginSpec = join(root, "specs/plugin/v0");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

function manifestValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  // The manifest references the item, view and connector specs, which reference it back.
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(pluginSpec, "../..", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema("https://endue.ai/specs/plugin/v0/plugin.schema.json");
  if (!validate) throw new Error("cannot compile plugin.schema.json");
  return validate;
}

// biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path root, not a placeholder
const HOME = "${home}/**";
const ID = "endue.explorer";

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

/** `*` in a cmd:invoke pattern matches any run of characters, dots included. */
const covers = (pattern: string, id: string) =>
  new RegExp(`^${pattern.split("*").join(".*")}$`).test(id);

describe("plugin.json", () => {
  it(`is a UI plugin on the left edge that may read and write under ${HOME}`, () => {
    const validate = manifestValidator();
    const explorer = manifest();
    expect(validate(explorer), JSON.stringify(validate.errors)).toBe(true);
    expect(explorer).toMatchObject({
      id: ID,
      name: "Explorer",
      kind: "ui",
      entry: "ui/index.html",
    });
    expect(existsSync(join(folder, explorer.entry ?? "missing"))).toBe(true);
    expect(explorer.surfaces).toEqual([{ id: "main", title: "Explorer", placement: "left" }]);
    expect(explorer.permissions).toEqual([
      { permission: "fs:read", paths: [HOME] },
      { permission: "fs:write", paths: [HOME] },
      {
        permission: "cmd:invoke",
        ids: [
          "desk.files.open",
          "desk.buffers.list",
          "desk.palette.pick",
          "endue.terminal.new",
          "endue.git.status",
        ],
      },
      { permission: "shell:open", paths: [HOME] },
    ]);
    // The explorer opens no file type itself: the desk's rules name the plugin that does.
    expect(explorer.contributes?.files).toBeUndefined();
  });

  it("contributes commands, keys and settings under its own id", () => {
    const { contributes } = manifest();
    const ids = (contributes?.commands ?? []).map((c) => c.id);
    expect(ids).toEqual([
      `${ID}.open`,
      `${ID}.reveal`,
      `${ID}.refresh`,
      `${ID}.toggle-hidden`,
      `${ID}.add-folder`,
      `${ID}.remove-folder`,
      `${ID}.new-file`,
      `${ID}.open-selected`,
      `${ID}.terminal-here`,
      `${ID}.git-here`,
      `${ID}.show-in-file-manager`,
    ]);
    for (const key of contributes?.keys ?? []) expect(ids).toContain(key.command);
    expect(contributes?.keys?.map((k) => k.key)).toEqual(["Mod+Shift+E", "Mod+Shift+R"]);
    for (const name of Object.keys(contributes?.settings ?? {})) {
      expect(name.startsWith(`${ID}.`)).toBe(true);
    }
    expect(contributes?.settings?.[`${ID}.folders`]?.default).toEqual(["~/Documents"]);
  });

  it("takes no key the desk's default keymap binds", () => {
    const taken = new Set(DEFAULT_KEYS.map((k) => k.key));
    for (const key of manifest().contributes?.keys ?? []) expect(taken.has(key.key)).toBe(false);
  });

  it("its cmd:invoke ids cover every desk command the code runs, and nothing more", () => {
    const source = readdirSync(join(folder, "ui"))
      .filter((n) => n.endsWith(".js"))
      .map((n) => readFileSync(join(folder, "ui", n), "utf8"))
      .join("\n");
    const run = new Set(
      [...source.matchAll(/commands\.run\("([a-z.-]+)"/g)].map((m) => m[1] ?? ""),
    );
    const grant = manifest().permissions?.find((p) => p.permission === "cmd:invoke");
    const ids = grant && "ids" in grant ? grant.ids : [];
    for (const id of run) expect(ids.some((pattern) => covers(pattern, id))).toBe(true);
    for (const pattern of ids) expect([...run].some((id) => covers(pattern, id))).toBe(true);
  });

  it("every contributed command has a handler", async () => {
    const { mount, disk, sample } = await import("./harness");
    const { host } = await mount({ handlers: disk(sample()), pick: () => undefined });
    for (const { id } of manifest().contributes?.commands ?? []) {
      const outcome = await host.command(id, {}).then(
        () => "answered",
        (error: Error) => error.message,
      );
      expect(outcome, id).not.toMatch(/unknown_command/);
    }
  });
});
