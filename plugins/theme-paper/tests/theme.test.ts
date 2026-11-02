import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PluginManifest, ThemePackage } from "../../../packages/bridge/src/index";
import { colors } from "../../../packages/ui/src/index";
import {
  compileTheme,
  contrast,
  gate,
  over,
  parseColor,
  toOklch,
} from "../../../packages/ui/src/theme/index";

// Paper & Ink: warm paper, ink-blue accents; Literata, grain and a paper tile, soft corners, calm motion.
const ID = "endue.theme-paper";
const root = join(import.meta.dirname, "../../..");
const folder = join(root, "plugins/theme-paper");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = () => readJson(join(folder, "plugin.json")) as PluginManifest;
const theme = () => manifest().theme as ThemePackage;
const SCHEMES = ["light", "dark"] as const;
const SURFACES = ["background", "card", "muted", "popover", "hover"];
const MiB = 1024 * 1024;

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

/** The shell's tokens (Eris's among them), as desk.shell contributes them. */
const shellTokens = () => {
  const shell = readJson(join(root, "plugins/shell/plugin.json")) as PluginManifest;
  return Object.keys(shell.contributes?.themes?.[0]?.tokens ?? {});
};
const ratio = (set: Record<string, string>, fg: string, bg: string, layer?: string) => {
  const color = (name: string) => {
    const parsed = set[name] === undefined ? undefined : parseColor(set[name]);
    if (!parsed) throw new Error(`${name} is not a colour: ${set[name]}`);
    return parsed;
  };
  return contrast(color(fg), layer ? over(color(layer), color(bg)) : color(bg));
};
const hue = (value: string | undefined) => toOklch(parseColor(value ?? "") ?? [0, 0, 0, 1])[2];

describe(ID, () => {
  it("is a valid theme plugin with a light and a dark variant and a licence for its fonts", () => {
    const validate = manifestValidator();
    const m = manifest();
    expect(validate(m), JSON.stringify(validate.errors)).toBe(true);
    expect(m).toMatchObject({ id: ID, name: "Paper & Ink", kind: "theme" });
    expect(theme().light).toBeDefined();
    expect(theme().dark).toBeDefined();
    expect(theme().license).toBe("Apache-2.0 AND OFL-1.1");
    expect(readFileSync(join(folder, "fonts/OFL.txt"), "utf8")).toContain(
      "SIL Open Font License, Version 1.1",
    );
  });

  describe.each(SCHEMES)("%s", (scheme) => {
    const tokens = () => compileTheme(theme(), scheme).tokens;

    it("sets every role colour, the shell's and Eris's tokens and the sixteen terminal colours", () => {
      const t = tokens();
      const names = [...Object.keys(colors), ...shellTokens()];
      expect(names.filter((n) => n.startsWith("eris")).length).toBeGreaterThanOrEqual(11);
      for (const name of names) expect(t[name], name).toBeDefined();
      const ansi = theme()[scheme]?.terminal?.ansi ?? [];
      expect(ansi).toHaveLength(16);
      expect(ansi.map((_, i) => t[`ansi${i}`])).toEqual(ansi);
    });

    it("passes the theme gate with no fixes", () => {
      expect(gate(tokens()).fixes).toEqual([]);
    });

    it("reaches 7:1 for key text on every surface in its derived high contrast", () => {
      const strong = gate(tokens(), { high: true }).tokens;
      for (const surface of SURFACES)
        for (const ink of ["text", "textMuted", "primaryText"])
          expect(ratio(strong, ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(7);
      expect(ratio(strong, "primaryForeground", "primary")).toBeGreaterThanOrEqual(7);
    });

    it("keeps the shell's own pairs readable", () => {
      const t = tokens();
      expect(ratio(t, "secondaryForeground", "secondary")).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t, "accent", "card")).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t, "statusAttentionText", "card")).toBeGreaterThanOrEqual(4.5);
      expect(ratio(t, "statusAttentionText", "card", "statusAttentionSoft")).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(ratio(t, "text", "card", "statusAttentionSoft")).toBeGreaterThanOrEqual(4.5);
      const outline = t.dotOutline === "transparent" ? 0 : ratio(t, "dotOutline", "card");
      for (const dot of [
        "successFill",
        "infoFill",
        "warningFill",
        "statusActive",
        "statusAttention",
      ])
        expect(Math.max(ratio(t, dot, "card"), outline), dot).toBeGreaterThanOrEqual(3);
    });

    it("carries the feeling: ink-blue accents, grain and a paper tile", () => {
      const variant = theme()[scheme];
      expect(hue(variant?.colors?.primary)).toBeGreaterThan(240);
      expect(hue(variant?.colors?.primary)).toBeLessThan(290);
      expect(variant?.material?.noise).toBeGreaterThan(0);
      expect(variant?.backdrop).toMatchObject({ image: `images/paper-${scheme}.png`, fit: "tile" });
    });
  });

  it("sets serif type with its own font, soft corners and calm motion", () => {
    const t = theme();
    expect(t.type?.sans).toMatch(/^"Literata", .*serif$/);
    expect(t.type?.fonts?.map((f) => [f.family, f.src, f.style])).toEqual([
      ["Literata", "fonts/literata.woff2", "normal"],
      ["Literata", "fonts/literata-italic.woff2", "italic"],
    ]);
    expect(t.shape?.radius).toBe("soft");
    expect(t.motion?.personality).toBe("calm");
  });

  it("brings every asset it names, within 2 MiB each and 8 MiB together, fonts with their source", () => {
    const t = theme();
    const fonts = (t.type?.fonts ?? []).map((f) => f.src);
    const images = SCHEMES.flatMap((s) => t[s]?.backdrop?.image ?? []);
    let total = 0;
    for (const path of [...fonts, ...images]) {
      const file = join(folder, path);
      expect(existsSync(file), path).toBe(true);
      const size = statSync(file).size;
      expect(size, path).toBeLessThanOrEqual(2 * MiB);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(8 * MiB);
    const source = readFileSync(join(folder, "fonts/SOURCE.md"), "utf8");
    for (const path of fonts) {
      const name = path.replace("fonts/", "");
      const sha = createHash("sha256")
        .update(readFileSync(join(folder, path)))
        .digest("hex");
      const line = source.split("\n").find((l) => l.includes(`\`${name}\``));
      expect(line, `${name} in SOURCE.md`).toContain(sha);
      expect(line).toMatch(/https:\/\/github\.com\/googlefonts\/literata\//);
    }
  });
});
