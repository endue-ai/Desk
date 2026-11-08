import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { opener } from "../../../packages/runtime/src/policies/files";

const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/player");
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

const VIDEO =
  "mp4 m4v mov qt mkv webm avi wmv asf flv f4v mpg mpeg m2ts mts vob 3gp 3g2 ogv rm rmvb mxf";
const AUDIO =
  "mp3 aac m4a m4b wav aif aiff aifc flac ogg oga opus weba caf wma ape wv mka amr dsf dff au snd mid midi";
const SUBTITLES = "srt vtt ass ssa sbv ttml dfxp smi sami";
const PLAYLISTS = "m3u m3u8 pls xspf cue";
const EXTENSIONS = [VIDEO, AUDIO, SUBTITLES, PLAYLISTS].flatMap((list) => list.split(" "));

const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;

describe("plugin.json", () => {
  it("is a UI plugin with one center surface and no fs paths of its own", () => {
    const validate = manifestValidator();
    const player = manifest();
    expect(validate(player), JSON.stringify(validate.errors)).toBe(true);
    expect(player.entry).toBe("ui/index.html");
    expect(existsSync(join(folder, player.entry ?? "missing"))).toBe(true);
    expect(player).toMatchObject({ id: "endue.player", name: "Player", kind: "ui" });
    expect(player.surfaces).toEqual([{ id: "main", title: "Player", placement: "center" }]);
    const fs = (player.permissions ?? []).filter((p) => p.permission.startsWith("fs:"));
    expect(fs).toEqual([]);
    expect(player.permissions).toContainEqual({
      permission: "cmd:invoke",
      ids: ["desk.files.changed"],
    });
    expect(player.contributes?.settings?.["endue.player.resume"]).toMatchObject({
      kind: "boolean",
      default: true,
    });
  });

  it("claims every listed video, audio, subtitle and playlist pattern, and not *.ts", () => {
    const patterns = (manifest().contributes?.files ?? []).map((rule) => rule.pattern);
    expect(patterns).toEqual(EXTENSIONS.map((ext) => `*.${ext}`));
    for (const rule of manifest().contributes?.files ?? [])
      expect(rule.plugin).toBe("endue.player");
    expect(patterns).not.toContain("*.ts");
  });

  it("the desk's opener picks the player for each, in any case, and nobody for .ts", () => {
    const owner = "endue.player";
    const rules = (manifest().contributes?.files ?? []).map((rule) => ({ ...rule, owner }));
    for (const ext of EXTENSIONS) {
      expect(opener(rules, `~/Movies/film.${ext}`), ext).toBe("endue.player");
      expect(opener(rules, `~/Movies/FILM.${ext.toUpperCase()}`), ext).toBe("endue.player");
    }
    expect(opener(rules, "~/src/index.ts")).toBeUndefined();
    expect(opener(rules, "~/notes.txt")).toBeUndefined();
  });

  it("autoloads: off at start, on when a file needs it, off after its last one (ADR 0046)", () => {
    expect(manifest().autoload).toBe(true);
  });
});
