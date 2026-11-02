// Checks this theme as the desk checks a theme before it applies one: it compiles for both schemes,
// passes the contrast gate over the endue palette with no fixes, and brings the files it names.
// From the Desk repository: pnpm exec vitest run --root <this folder>
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginManifest, ThemePackage } from "../../../packages/bridge/src/index";
import { compileTheme, gate } from "../../../packages/ui/src/theme/index";

/** The Desk repository, whose theme compiler, gate and endue palette the checks use. */
const desk = resolve(import.meta.dirname, "../../..");
const folder = resolve(import.meta.dirname, "..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const manifest = readJson(join(folder, "plugin.json")) as PluginManifest;
const theme = (manifest.theme ?? {}) as ThemePackage;
const SCHEMES = ["light", "dark"] as const;
const MiB = 1024 * 1024;

/** The endue theme's palette for a scheme: what every role this theme leaves out keeps. */
function endue(scheme: (typeof SCHEMES)[number]): Record<string, string> {
  const own = readJson(join(desk, "plugins/theme/plugin.json")) as PluginManifest;
  const tokens = own.contributes?.themes?.find((t) => t.id === `desk.theme.${scheme}`)?.tokens;
  if (!tokens) throw new Error(`the endue palette for ${scheme} is missing`);
  return { ...tokens };
}

describe(manifest.id, () => {
  it("is a theme with a licence, a light and a dark variant", () => {
    expect(manifest.kind).toBe("theme");
    expect(theme.license).toMatch(/\S/);
    for (const scheme of SCHEMES) expect(theme[scheme], scheme).toBeDefined();
  });

  it.each(SCHEMES)("compiles for %s and passes the gate with no fixes", (scheme) => {
    const compiled = compileTheme(theme, scheme);
    expect(compiled.hasScheme).toBe(true);
    const base = endue(scheme);
    // What the desk does when it applies the theme: its values over the endue palette, gated.
    expect(gate({ ...base, ...compiled.tokens }, { fallback: base }).fixes).toEqual([]);
  });

  it("brings every font and image it names, 2 MiB each and 8 MiB together", () => {
    const paths = [
      ...(theme.type?.fonts ?? []).map((font) => font.src),
      ...SCHEMES.flatMap((scheme) => theme[scheme]?.backdrop?.image ?? []),
    ];
    let total = 0;
    for (const path of paths) {
      const file = join(folder, path);
      expect(existsSync(file), path).toBe(true);
      const size = statSync(file).size;
      expect(size, path).toBeLessThanOrEqual(2 * MiB);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(8 * MiB);
  });
});
