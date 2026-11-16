// plugin.json as specs/plugin/v0 reads it, the commands as agents see them, and what the folder
// holds: the entry, the catalogs, the OUI asset; nothing that scans beyond macOS's own programs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { timelineData } from "../ui/journal.js";
import { PROGRAMS } from "../ui/run.js";
import { timelineView } from "../ui/view-log.js";
import { englishT } from "./harness";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/network");
const readJson = (path: string): any => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(join(folder, "plugin.json"));

function validator(id = "https://endue.ai/specs/plugin/v0/plugin.schema.json") {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)));
  }
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`cannot compile ${id}`);
  return validate;
}

describe("plugin.json", () => {
  it("is endue.network: a UI plugin, autoload, one main surface, its own catalogs", () => {
    const validate = validator();
    expect(validate(manifest), JSON.stringify(validate.errors)).toBe(true);
    expect(manifest).toMatchObject({
      id: "endue.network",
      kind: "ui",
      autoload: true,
      messages: "messages",
    });
    expect(manifest.surfaces).toEqual([{ id: "main", title: "Network", placement: "center" }]);
    expect(existsSync(join(folder, manifest.entry))).toBe(true);
    expect(existsSync(join(folder, "messages/en.json"))).toBe(true);
    expect(existsSync(join(folder, "messages/ko.json"))).toBe(true);
  });

  it("may run only macOS's own programs, by their full paths, and nothing that scans", () => {
    const spawn = manifest.permissions.find((p: any) => p.permission === "proc:spawn");
    expect(spawn.commands).toEqual(Object.values(PROGRAMS));
    expect(spawn.pty).toBeUndefined();
    expect(manifest.permissions.map((p: any) => p.permission).sort()).toEqual([
      "brain:ask",
      "proc:spawn",
      "ui:notify",
    ]);
    const everything = readdirSync(join(folder, "ui"))
      .map((name) => readFileSync(join(folder, "ui", name), "utf8"))
      .join("\n");
    expect(everything).not.toMatch(/\bnmap\b|npcap|\/bin\/sh|\bbash\b/i);
  });

  it("contributes the seven commands under its own id, the readers marked read-only for agents", () => {
    const commands = manifest.contributes.commands;
    expect(commands.map((c: any) => c.id)).toEqual([
      "endue.network.open",
      "endue.network.scan",
      "endue.network.devices",
      "endue.network.name",
      "endue.network.checkup",
      "endue.network.channels",
      "endue.network.log",
    ]);
    expect(commands[0].runs).toEqual({
      command: "desk.plugins.open",
      args: { plugin: "endue.network" },
    });
    const readOnly = commands.filter((c: any) => c.readOnly).map((c: any) => c.id);
    expect(readOnly).toEqual([
      "endue.network.devices",
      "endue.network.channels",
      "endue.network.log",
    ]);
    for (const c of commands.slice(1)) {
      expect(c.agent, c.id).toBe(true);
      expect(c.description.length, c.id).toBeGreaterThan(40);
      expect(c.args.type, c.id).toBe("object");
    }
    expect(manifest.contributes.settings["endue.network.interval"]).toMatchObject({
      kind: "integer",
      default: 5,
    });
  });

  it("carries the IEEE OUI registry as an asset", () => {
    const oui = join(folder, "assets/oui.txt");
    expect(statSync(oui).size).toBeLessThan(2 * 1024 * 1024);
    const lines = readFileSync(oui, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(30_000);
    expect(lines.every((l) => /^[0-9A-F]{6}\t\S/.test(l))).toBe(true);
    expect(lines).toContain("F0D1A9\tApple");
  });

  it("hands the desk a timeline that specs/view/v0 accepts", async () => {
    const t = await englishT();
    const data = timelineData(
      [
        { kind: "first", at: "2026-11-17T00:00:00.000Z", count: 3 },
        {
          kind: "new",
          at: "2026-11-17T01:00:00.000Z",
          mac: "a4:83:e7:01:02:03",
          ip: "192.168.0.77",
        },
      ],
      new Map(),
      t,
    );
    const validate = validator(
      "https://endue.ai/specs/view/v0/universal.schema.json#/$defs/UniversalView",
    );
    expect(validate(timelineView(t, data)), JSON.stringify(validate.errors)).toBe(true);
  });
});
