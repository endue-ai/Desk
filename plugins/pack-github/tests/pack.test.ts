// desk.pack-github, the first built-in pack (ADR 0108): data only, it brings desk.github, opens a
// board and a timeline of its work (universal views over the desk.github items, ADR 0087) and switches
// to the "Builder morning" profile. Make with Eris finds it by "github" or "깃허브".
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest, UniversalView } from "../../../packages/bridge/src/index";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(root, "plugins/pack-github/plugin.json")) as PluginManifest;

function validator(target: string) {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0", "agent/v0", "market/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".schema.json")))
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(target);
  if (!validate) throw new Error(`cannot compile ${target}`);
  return validate;
}

describe("desk.pack-github", () => {
  it("is a pack that brings desk.github and runs no code", () => {
    const plugin = manifest();
    const validate = validator("https://endue.ai/specs/plugin/v0/plugin.schema.json");
    expect(validate(plugin), JSON.stringify(validate.errors)).toBe(true);
    expect(plugin).toMatchObject({ id: "desk.pack-github", name: "GitHub", kind: "pack" });
    expect(plugin.entry).toBeUndefined();
    expect(plugin.pack?.plugins).toEqual(["desk.github"]);
    expect(plugin.pack?.services).toEqual(expect.arrayContaining(["github", "깃허브"]));
    expect(plugin.pack?.opens).toEqual([{ command: "desk.pack-github.board" }]);
    expect(plugin.pack?.profile).toBe("builder-morning");
  });

  it("opens a board and a timeline of the desk.github items as universal views", () => {
    const commands = manifest().contributes?.commands ?? [];
    const view = (id: string) => {
      const command = commands.find((c) => c.id === id);
      expect(command?.runs?.command).toBe("desk.universal.open");
      const args = command?.runs?.args as { view: UniversalView } | undefined;
      if (!args) throw new Error(`${id} opens nothing`);
      return args.view;
    };
    const validate = validator(
      "https://endue.ai/specs/view/v0/universal.schema.json#/$defs/UniversalView",
    );
    for (const [id, type] of [
      ["desk.pack-github.board", "kanban"],
      ["desk.pack-github.timeline", "timeline"],
    ] as const) {
      const drawn = view(id);
      expect(validate(drawn), JSON.stringify(validate.errors)).toBe(true);
      expect(drawn.type).toBe(type);
      expect(drawn.source).toMatchObject({ items: { kinds: ["task"], sources: ["desk.github"] } });
    }
  });

  it("turns GitHub, Today and Projects on in Builder morning, and places no window", () => {
    const profiles = manifest().contributes?.profiles ?? [];
    const morning = profiles.find((p) => p.id === "builder-morning");
    expect(morning?.name).toBe("Builder morning");
    expect(morning?.plugins?.enabled).toEqual(
      expect.arrayContaining(["desk.github", "desk.pack-github", "desk.today", "endue.projects"]),
    );
    // The board is an overlay, not a window; a window the profile placed would stay in the drawer
    // after Undo switches back, so Apply and Undo leave the windows as they are (#161).
    const mode = morning?.settings?.["desk.shell.mode"] as Record<string, unknown>;
    expect(mode).toMatchObject({ icon: "sunrise", triggers: { time: "07:00-10:00" } });
    expect(mode.desktops).toBeUndefined();
    expect(mode.desktop).toBeUndefined();
  });
});
