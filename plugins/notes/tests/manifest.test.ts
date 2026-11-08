import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";
import { opener } from "../../../packages/runtime/src/policies/files";
import { type KeyEntry, resolveBindings } from "../../../packages/runtime/src/sequences/conflicts";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/notes");
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

// biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest's path root, not a placeholder
const HOME = "${home}";
const NOTES = `${HOME}/Notes/**`;

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it(`is a UI plugin that opens *.md and *.txt under ${HOME}/Notes`, () => {
    const validate = manifestValidator();
    const notes = manifest();
    expect(validate(notes), JSON.stringify(validate.errors)).toBe(true);
    expect(notes.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, notes.entry ?? "missing"))).toBe(true);
    expect(notes).toMatchObject({ id: "endue.notes", name: "Notes", kind: "ui" });
    expect(notes.surfaces).toEqual([{ id: "main", title: "Notes", placement: "center" }]);
    expect(notes.contributes?.files).toEqual([
      { pattern: "*.md", plugin: "endue.notes" },
      { pattern: "*.txt", plugin: "endue.notes" },
    ]);
    expect(notes.permissions).toEqual([
      { permission: "fs:read", paths: [NOTES] },
      { permission: "fs:write", paths: [NOTES] },
      {
        permission: "cmd:invoke",
        ids: [
          "desk.files.changed",
          "desk.buffers.update",
          "desk.files.open",
          "desk.buffers.switch",
        ],
      },
    ]);
  });

  it("contributes endue.notes.new on Mod+Alt+N and endue.notes.find as the Notes palette provider, without a key conflict", () => {
    const { contributes } = manifest();
    expect(contributes?.commands?.map((c) => c.id)).toEqual([
      "endue.notes.new",
      "endue.notes.find",
      "endue.notes.search-open",
    ]);
    expect(contributes?.commands?.[0]).toMatchObject({ title: "New note" });
    expect(contributes?.keys).toEqual([{ key: "Mod+Alt+N", command: "endue.notes.new" }]);
    expect(contributes?.paletteProviders).toEqual([
      { command: "endue.notes.find", title: "Notes" },
    ]);

    // Every layer but the person's: the desk's defaults, then every built-in plugin's keys.
    const entries: KeyEntry[] = [...DEFAULT_KEYS];
    for (const name of readdirSync(join(root, "plugins")).sort()) {
      const path = join(root, "plugins", name, "plugin.json");
      if (!existsSync(path)) continue;
      const plugin = readJson(path) as PluginManifest;
      for (const key of plugin.contributes?.keys ?? []) entries.push({ ...key, owner: plugin.id });
    }
    for (const platform of ["mac", "other"] as const) {
      const { bindings, conflicts } = resolveBindings(entries, platform);
      const mine = conflicts.filter(
        (c) => c.binding.owner === "endue.notes" || c.by?.owner === "endue.notes",
      );
      expect(mine, platform).toEqual([]);
      expect(bindings.filter((b) => b.command === "endue.notes.new")).toHaveLength(1);
    }
  });

  it("the desk's opener rule picks notes for .md and .txt and nobody for .html", () => {
    // Layered as the runtime does (packages/runtime/src/policy.ts): each rule carries its owner.
    const owner = "endue.notes";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    expect(opener(rules, "~/Notes/a.md")).toBe("endue.notes");
    expect(opener(rules, "~/x.txt")).toBe("endue.notes");
    expect(opener(rules, "~/a.html")).toBeUndefined();
  });
});
