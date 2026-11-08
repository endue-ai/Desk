import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { DEFAULT_KEYS } from "../../../packages/runtime/src/core/keys";
import { lintPlugin } from "../../../scripts/ui-lint.mjs";
import { ACTION_PATTERNS, ACTIONS, actionId } from "../ui/actions.js";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/chat");
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

const ID = "endue.chat";
const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;
const covers = (pattern: string, id: string) =>
  new RegExp(`^${pattern.split("*").join(".*")}$`).test(id);

describe("plugin.json", () => {
  it("is a UI plugin that reads message items, runs the connectors' chat actions and opens links", () => {
    const validate = manifestValidator();
    const chat = manifest();
    expect(validate(chat), JSON.stringify(validate.errors)).toBe(true);
    expect(chat).toMatchObject({ id: ID, name: "Chat", kind: "ui", entry: "ui/index.html" });
    expect(existsSync(join(folder, chat.entry ?? "missing"))).toBe(true);
    expect(chat.surfaces).toEqual([{ id: "main", title: "Chat", placement: "center" }]);
    expect(chat.permissions).toEqual([
      { permission: "data:read", kinds: ["message"] },
      { permission: "cmd:invoke", ids: [...ACTION_PATTERNS, "desk.palette.pick"] },
      { permission: "ui:notify" },
      { permission: "shell:open", schemes: ["http", "https", "mailto"] },
      // connector.list: which installed connectors bring messages, for the empty state's words.
      { permission: "connector:manage" },
    ]);
    expect(chat.contributes?.files).toBeUndefined();
  });

  it("contributes its commands, one key, a palette provider and settings under its own id", () => {
    const { contributes } = manifest();
    const ids = (contributes?.commands ?? []).map((c) => c.id);
    expect(ids).toEqual(
      [
        "open",
        "show",
        "conversation",
        "layout",
        "filter",
        "platform",
        "search",
        "refresh",
        "next-unread",
        "send",
        "reply",
        "react",
        "edit",
        "delete",
        "mark-read",
        "mark-all-read",
        "save",
        "pin",
        "find",
      ].map((n) => `${ID}.${n}`),
    );
    // What an agent cannot take back waits for the person (ADR 0078).
    const irreversible = (contributes?.commands ?? [])
      .filter((c) => c.irreversible)
      .map((c) => c.id);
    expect(irreversible).toEqual([`${ID}.send`, `${ID}.delete`]);
    for (const key of contributes?.keys ?? []) expect(ids).toContain(key.command);
    expect(contributes?.paletteProviders).toEqual([{ command: `${ID}.find`, title: "Chats" }]);
    expect(Object.keys(contributes?.settings ?? {})).toEqual(
      ["page", "notify", "mark-read", "enter-sends", "density", "quick-reactions"].map(
        (k) => `${ID}.${k}`,
      ),
    );
  });

  it("takes no key the desk or another built-in plugin binds", () => {
    const taken = new Set(DEFAULT_KEYS.map((k) => k.key));
    for (const name of readdirSync(join(root, "plugins"))) {
      const path = join(root, "plugins", name, "plugin.json");
      if (name === "chat" || !existsSync(path)) continue;
      for (const key of (readJson(path) as PluginManifest).contributes?.keys ?? [])
        taken.add(key.key);
    }
    for (const key of manifest().contributes?.keys ?? [])
      expect(taken.has(key.key), key.key).toBe(false);
  });

  it("its cmd:invoke ids cover every command the code runs, and nothing more", () => {
    const files = readdirSync(join(folder, "ui"), { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".js"))
      .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"))
      .join("\n");
    const run = new Set([
      ...[...files.matchAll(/commands\.run\("([a-z.-]+)"/g)].map((m) => m[1] ?? ""),
      ...ACTIONS.map((action) => actionId("acme.slack", action)),
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
    for (const id of ["desk.files.open", "endue.mail.send", "acme.slack.send", "acme.chat"])
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

  it("reads every colour, font, size, radius and duration from the theme", () => {
    expect(lintPlugin("chat")).toEqual([]);
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
