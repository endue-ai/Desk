// The files of a new theme: a plugin of kind theme (ADR 0056, ADR 0057) laid out like
// examples/plugin-hello-theme, with the palette in ./theme-palette and the README in ./theme-readme.

import type { PluginManifest, ThemeMaterial } from "@endue-ai/bridge";
import exampleTest from "../../../examples/plugin-hello-theme/tests/theme.test.ts?raw";
import type { PluginOptions } from "./template";
import { DARK, LIGHT } from "./theme-palette";
import { themeReadme } from "./theme-readme";

/** Where the example's test finds the Desk repository: three folders up from `tests/`. */
const EXAMPLE_DESK = "../..";

/** The licence a new theme starts with; the README asks the person to set their own. */
const LICENSE = "Apache-2.0";

/** Every file of the theme folder, keyed by its path relative to the folder. */
export function renderTheme(options: PluginOptions): Record<string, string> {
  return {
    "plugin.json": manifest(options),
    "README.md": themeReadme(options, LICENSE),
    "tests/theme.test.ts": themeTest(options.desk ?? EXAMPLE_DESK),
  };
}

/** The material layer at its defaults: opaque, no blur or grain, 1px borders, the scheme's shadows. */
const MATERIAL: ThemeMaterial = { opacity: 1, blur: 0, noise: 0, border: 1, shadow: "soft" };

function manifest({ id, name, description }: PluginOptions): string {
  const value: PluginManifest = {
    id,
    name,
    version: "0.1.0",
    kind: "theme",
    ...(description === undefined ? {} : { description }),
    theme: {
      license: LICENSE,
      // The desk's own font stacks (@endue-ai/ui scale): put a font of the theme's first.
      type: {
        sans: '"Inter", "SUIT Variable", "SUIT", -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
        mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
        scale: 1,
        tracking: 0,
      },
      shape: { radius: "soft", density: "comfortable" },
      motion: { personality: "smooth" },
      light: { colors: LIGHT, material: MATERIAL },
      dark: { colors: DARK, material: MATERIAL },
    },
  };
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The example's test with its paths to the Desk repository rewritten for the new folder: `desk` is
 * the repository relative to the folder, so the test reaches it from `tests/` one level further up.
 */
function themeTest(desk: string): string {
  if (desk === EXAMPLE_DESK) return exampleTest;
  // An absolute path (another drive on Windows) is used as it is.
  const path = /^([A-Za-z]:)?\//.test(desk) ? desk : `../${desk}`;
  return exampleTest.replaceAll(`"../${EXAMPLE_DESK}`, `"${path}`);
}
