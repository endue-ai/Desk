import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";
import { ACTION_PATTERNS, ACTIONS, actionId } from "../ui/actions.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/mail");
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

const ID = "endue.mail";
const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

/** `*` in a cmd:invoke pattern matches any run of characters, dots included. */
const covers = (pattern: string, id: string) =>
  new RegExp(`^${pattern.split("*").join(".*")}$`).test(id);

describe("plugin.json", () => {
  it("is a UI plugin on the grid that reads message items and runs the connector's mail actions", () => {
    const validate = manifestValidator();
    const mail = manifest();
    expect(validate(mail), JSON.stringify(validate.errors)).toBe(true);
    expect(mail).toMatchObject({ id: ID, name: "Mail", kind: "ui", entry: "ui/index.html" });
    expect(existsSync(join(folder, mail.entry ?? "missing"))).toBe(true);
    expect(mail.surfaces).toEqual([{ id: "main", title: "Mail", placement: "center" }]);
    expect(mail.permissions).toEqual([
      { permission: "data:read", kinds: ["message"] },
      { permission: "cmd:invoke", ids: [...ACTION_PATTERNS, "desk.palette.pick"] },
      { permission: "ui:notify" },
    ]);
    // The mail plugin opens no file type and writes no item: the connectors' commands do.
    expect(mail.contributes?.files).toBeUndefined();
  });

  it("contributes commands, one key and settings under its own id", () => {
    const { contributes } = manifest();
    const ids = (contributes?.commands ?? []).map((c) => c.id);
    expect(ids).toEqual([
      `${ID}.open`,
      `${ID}.show`,
      `${ID}.mailbox`,
      `${ID}.search`,
      `${ID}.refresh`,
      `${ID}.compose`,
      `${ID}.reply`,
      `${ID}.forward`,
      `${ID}.send`,
      `${ID}.discard`,
      `${ID}.archive`,
      `${ID}.trash`,
      `${ID}.flag`,
      `${ID}.toggle-unread`,
      `${ID}.rsvp`,
    ]);
    for (const key of contributes?.keys ?? []) expect(ids).toContain(key.command);
    expect(contributes?.keys?.map((k) => k.key)).toEqual(["Mod+Shift+I"]);
    const settings = Object.keys(contributes?.settings ?? {});
    expect(settings).toEqual(
      ["page", "notify", "mark-read", "signature", "addresses"].map((k) => `${ID}.${k}`),
    );
    expect(contributes?.settings?.[`${ID}.mark-read`]?.choices).toEqual(["open", "never"]);
  });

  it("takes no key the desk's default keymap binds", () => {
    const taken = new Set(DEFAULT_KEYS.map((k) => k.key));
    for (const key of manifest().contributes?.keys ?? []) expect(taken.has(key.key)).toBe(false);
  });

  it("its cmd:invoke ids cover every command the code runs, and nothing more", () => {
    const source = readdirSync(join(folder, "ui"))
      .filter((n) => n.endsWith(".js"))
      .map((n) => readFileSync(join(folder, "ui", n), "utf8"))
      .join("\n");
    // Desk commands by name, and the connector's actions by their id convention.
    const run = new Set([
      ...[...source.matchAll(/commands\.run\("([a-z.-]+)"/g)].map((m) => m[1] ?? ""),
      ...ACTIONS.map((action) => actionId("acme.imap", action)),
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
    // The patterns never cover the desk's own commands by accident.
    for (const id of ["desk.files.open", "desk.palette.pick", "desk.keys.quit", "acme.imap.send"])
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
      expect(outcome, id).not.toMatch(/unknown_command/);
    }
  });

  it("keeps every file under 400 lines and the README under 40", () => {
    const files = readdirSync(join(folder, "ui"), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n").length;
      expect(lines, file).toBeLessThanOrEqual(400);
    }
    expect(
      readFileSync(join(folder, "README.md"), "utf8").trimEnd().split("\n").length,
    ).toBeLessThanOrEqual(40);
  });
});
