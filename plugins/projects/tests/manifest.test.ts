import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";
import { ACTION_PATTERNS, ACTIONS, actionId } from "../ui/actions.js";
import { COLUMNS, VIEWS } from "../ui/model.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/projects");
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

const ID = "endue.projects";
const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;
/** `*` in a cmd:invoke pattern matches any run of characters, dots included. */
const covers = (pattern: string, id: string) =>
  new RegExp(`^${pattern.split("*").join(".*")}$`).test(id);
const sources = () =>
  readdirSync(join(folder, "ui"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

describe("plugin.json", () => {
  it("is a UI plugin that reads task items, runs the connectors' task actions and opens https links", () => {
    const validate = manifestValidator();
    const projects = manifest();
    expect(validate(projects), JSON.stringify(validate.errors)).toBe(true);
    expect(projects).toMatchObject({
      id: ID,
      name: "Projects",
      kind: "ui",
      entry: "ui/index.html",
    });
    expect(existsSync(join(folder, projects.entry ?? "missing"))).toBe(true);
    expect(projects.surfaces).toEqual([{ id: "main", title: "Projects", placement: "center" }]);
    expect(projects.permissions).toEqual([
      { permission: "data:read", kinds: ["task"] },
      {
        permission: "cmd:invoke",
        ids: [...ACTION_PATTERNS, "desk.palette.pick", "desk.connectors.open"],
      },
      { permission: "shell:open", schemes: ["https"] },
    ]);
    // It writes no item and opens no file: the connectors' commands change work.
    expect(projects.contributes?.files).toBeUndefined();
  });

  it("contributes commands, one key and settings under its own id", () => {
    const { contributes } = manifest();
    const ids = (contributes?.commands ?? []).map((c) => c.id);
    expect(ids).toEqual(
      [
        "open",
        "view",
        "group",
        "search",
        "source",
        "show-done",
        "zoom",
        "go",
        "refresh",
        "connect",
        "show",
        "move",
        "update",
        "open-original",
      ].map((name) => `${ID}.${name}`),
    );
    for (const key of contributes?.keys ?? []) expect(ids).toContain(key.command);
    expect(contributes?.keys?.map((k) => k.key)).toEqual(["Mod+Shift+U"]);
    const settings = contributes?.settings ?? {};
    expect(Object.keys(settings)).toEqual(
      ["view", "week-start", "show-done", "columns"].map((k) => `${ID}.${k}`),
    );
    expect(settings[`${ID}.view`]?.choices).toEqual(VIEWS);
    const columns = (settings[`${ID}.columns`]?.default ?? []) as string[];
    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) expect(COLUMNS).toContain(column);
  });

  it("takes no key the desk or another built-in plugin binds", () => {
    const taken = new Set(DEFAULT_KEYS.map((k) => k.key));
    for (const name of readdirSync(join(root, "plugins"))) {
      const path = join(root, "plugins", name, "plugin.json");
      if (name === "projects" || !existsSync(path)) continue;
      for (const k of (readJson(path) as PluginManifest).contributes?.keys ?? []) taken.add(k.key);
    }
    for (const key of manifest().contributes?.keys ?? [])
      expect(taken.has(key.key), key.key).toBe(false);
  });

  it("its cmd:invoke ids cover every command the code runs, and nothing more", () => {
    const code = sources()
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const run = new Set([
      ...[...code.matchAll(/commands\.run\("([a-z.-]+)"/g)].map((m) => m[1] ?? ""),
      ...ACTIONS.map((action) => actionId("acme.jira", action)),
    ]);
    const grant = manifest().permissions?.find((p) => p.permission === "cmd:invoke");
    const ids = grant && "ids" in grant ? grant.ids : [];
    for (const id of run)
      expect(
        ids.some((pattern) => covers(pattern, id)),
        id,
      ).toBe(true);
    for (const pattern of ids)
      expect(
        [...run].some((id) => covers(pattern, id)),
        pattern,
      ).toBe(true);
    for (const id of ["desk.files.open", "desk.keys.quit", "acme.jira.mail.send", "acme.jira.task"])
      expect(
        ACTION_PATTERNS.some((pattern) => covers(pattern, id)),
        id,
      ).toBe(false);
  });

  it("every contributed command has a handler", async () => {
    const { mount } = await import("./harness");
    const { host } = await mount({ pick: () => undefined });
    for (const { id } of manifest().contributes?.commands ?? []) {
      const outcome = await host.command(id, {}).then(
        () => "answered",
        (error: Error) => error.message,
      );
      expect(outcome, id).not.toMatch(/unknown_command|has no command/);
    }
  });

  it("keeps every file under 400 lines and the README under 40", () => {
    for (const file of sources()) {
      const lines = readFileSync(file, "utf8").split("\n").length;
      expect(lines, file).toBeLessThanOrEqual(400);
    }
    expect(
      readFileSync(join(folder, "README.md"), "utf8").trimEnd().split("\n").length,
    ).toBeLessThanOrEqual(40);
  });
});
