// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  PluginInfo,
  PluginManifest,
  ThemeBundle,
  ThemeIndex,
  ThemeMarketListResult,
  ThemeMarketTheme,
} from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeThemes } from "../policies/theme";
import { collect } from "../policy";
import { resolveTheme, type ThemeState } from "../theme";
import { studioText } from "./copy";
import { bundleFiles, createMarket, previewScheme } from "./market";

const repo = join(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(join(repo, path), "utf8");

describe("this repository's market", () => {
  const manifest = (name: string): PluginInfo => {
    const m = JSON.parse(read(`plugins/${name}/plugin.json`)) as PluginManifest;
    return { id: m.id, status: "ready", enabled: true, builtIn: true, revision: 1, manifest: m };
  };
  const { themes } = collect([manifest("theme"), manifest("shell")]);
  const index = JSON.parse(read("market/themes/index.json")) as ThemeIndex;

  it("has at least two themes, each with a licence", () => {
    expect(index.themes.length).toBeGreaterThanOrEqual(2);
    for (const entry of index.themes) {
      const bundle = JSON.parse(read(`market/themes/${entry.url}`)) as ThemeBundle;
      expect(bundle.manifest.theme?.license, entry.id).toBe(entry.license);
    }
  });

  it.each(
    index.themes.flatMap((entry) =>
      (["light", "dark"] as const).map((s) => [entry.id, s] as const),
    ),
  )("%s passes the gate in the %s scheme as the desk applies it", (id, scheme) => {
    const entry = index.themes.find((t) => t.id === id);
    const bundle = JSON.parse(read(`market/themes/${entry?.url}`)) as ThemeBundle;
    const theme = bundle.manifest.theme;
    if (!theme) throw new Error(`${id} has no theme block`);
    expect(theme[scheme], `${id} has a ${scheme} variant`).toBeDefined();
    const state = resolveTheme(
      themes,
      { scheme, contrast: "normal", motion: "full", active: id },
      { dark: scheme === "dark", highContrast: false, reducedMotion: false },
      [{ id, name: entry?.name ?? id, theme, url: (path) => path }],
    );
    expect(state.active).toBe(id);
    expect(state.fixes).toEqual([]);
  });
});

const listed = (id: string, state: ThemeMarketTheme["state"], installed?: string) => ({
  theme: {
    id,
    name: id === "market.fern" ? "Fern" : "Dune",
    version: "1.1.0",
    description: "Deep greens.",
    author: "Team endue",
    license: "CC0-1.0",
    preview: ["#0f1d17", "#7fd1a8"],
    url: `https://market.test/${id.slice(7)}.desk-theme`,
    sha256: "a".repeat(64),
    size: 800,
  },
  market: "https://market.test/index.json",
  state,
  ...(installed ? { installed } : {}),
});

const fern: ThemeBundle = {
  format: "desk-theme/1",
  manifest: {
    id: "market.fern",
    name: "Fern",
    version: "1.1.0",
    kind: "theme",
    theme: {
      type: { fonts: [{ family: "Fern", src: "fonts/fern.woff2" }] },
      light: { colors: { background: "#f2f7f3" } },
    },
  },
  files: { "fonts/fern.woff2": "d09GMg==" },
};

function setup(result: ThemeMarketListResult, fetch = vi.fn(async () => fern)) {
  const list = vi.fn(async () => result);
  const install = vi.fn(async () => "market.fern");
  const previewDraft = vi.fn();
  const apply = vi.fn();
  const themes = {
    state: () => ({ scheme: "dark" }) as ThemeState,
    active: () => "",
    previewDraft,
    apply,
    market: () => ({ list, fetch, install }),
  } as unknown as RuntimeThemes;
  const back = vi.fn();
  const market = createMarket({ themes, tr: (key) => studioText("en", key), open: vi.fn(), back });
  document.body.replaceChildren(market.element);
  market.start();
  return { market, list, fetch, install, previewDraft, apply, back };
}

const card = (id: string) => document.querySelector<HTMLElement>(`[data-theme="${id}"]`);
const press = (id: string, key: string) =>
  card(id)?.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)?.click();

describe("the Market tab", () => {
  it("shows each theme's colours, name, author, licence and how it stands on this desk", async () => {
    const problems = [{ market: "https://gone.test/index.json", message: "answered 404" }];
    setup({
      themes: [listed("market.fern", "update", "1.0.0"), listed("market.dune", "edited", "1.0.0")],
      problems,
    });
    await vi.waitFor(() => expect(card("market.fern")).not.toBeNull());
    const text = card("market.fern")?.textContent ?? "";
    for (const words of ["Fern", "1.1.0", "Team endue", "CC0-1.0", "Update available"])
      expect(text).toContain(words);
    expect(card("market.fern")?.querySelectorAll(".theme-market-swatches > span")).toHaveLength(2);
    expect(card("market.fern")?.querySelector('[data-key="market-install"]')?.textContent).toBe(
      "Update",
    );
    // One the person changed keeps their changes: Apply only.
    expect(card("market.dune")?.querySelector('[data-key="market-install"]')).toBeNull();
    expect(card("market.dune")?.textContent).toContain("Edited");
    expect(document.querySelector(".theme-market-problem")?.textContent).toContain("gone.test");
  });

  it("previews a download on the whole desk without installing it, and ends it on leaving", async () => {
    const { market, fetch, install, previewDraft } = setup({
      themes: [listed("market.fern", "available")],
      problems: [],
    });
    await vi.waitFor(() => expect(card("market.fern")).not.toBeNull());
    press("market.fern", "market-preview");
    await vi.waitFor(() => expect(previewDraft).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith("https://market.test/fern.desk-theme", "a".repeat(64));
    // Fern has a light variant only, so it is previewed in light; its font comes as a data: URL.
    expect(previewDraft).toHaveBeenCalledWith(
      fern.manifest.theme,
      { "fonts/fern.woff2": "data:font/woff2;base64,d09GMg==" },
      "light",
    );
    expect(install).not.toHaveBeenCalled();
    expect(card("market.fern")?.classList.contains("is-previewing")).toBe(true);
    market.stop();
    expect(previewDraft).toHaveBeenLastCalledWith(undefined);
  });

  it("installs through theme.import with the url, sha256 and market, then lists the markets again", async () => {
    const { install, list } = setup({ themes: [listed("market.fern", "available")], problems: [] });
    await vi.waitFor(() => expect(card("market.fern")).not.toBeNull());
    expect(card("market.fern")?.querySelector('[data-key="market-apply"]')).toBeNull();
    press("market.fern", "market-install");
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(install).toHaveBeenCalledWith({
      url: "https://market.test/fern.desk-theme",
      sha256: "a".repeat(64),
      market: "https://market.test/index.json",
    });
    expect(document.querySelector(".theme-market-note")?.textContent).toBe("Installed: Fern");
  });

  it("applies an installed theme and goes back to the gallery with it", async () => {
    const { apply, back } = setup({
      themes: [listed("market.fern", "installed", "1.1.0")],
      problems: [],
    });
    await vi.waitFor(() => expect(card("market.fern")).not.toBeNull());
    press("market.fern", "market-apply");
    expect(apply).toHaveBeenCalledWith("market.fern");
    expect(back).toHaveBeenCalledWith("market.fern");
  });

  it("says why a download was refused and previews nothing", async () => {
    const refused = vi.fn(async () => {
      throw new Error("https://market.test/fern.desk-theme: sha256 b…, not a…");
    });
    const { previewDraft } = setup(
      { themes: [listed("market.fern", "available")], problems: [] },
      refused,
    );
    await vi.waitFor(() => expect(card("market.fern")).not.toBeNull());
    press("market.fern", "market-preview");
    await vi.waitFor(() =>
      expect(document.querySelector(".theme-market-note")?.textContent).toContain("Failed: "),
    );
    expect(document.querySelector(".theme-market-note")?.textContent).toContain("sha256");
    expect(previewDraft).not.toHaveBeenCalled();
  });
});

describe("a bundle as a preview", () => {
  it("serves its files as data: URLs and previews in a scheme it has", () => {
    const files = { "images/a.webp": "UklG", "fonts/b.woff2": "d09G", "x.bin": "AA==" };
    expect(bundleFiles({ ...fern, files })).toEqual({
      "images/a.webp": "data:image/webp;base64,UklG",
      "fonts/b.woff2": "data:font/woff2;base64,d09G",
      "x.bin": "data:application/octet-stream;base64,AA==",
    });
    expect(previewScheme(fern, "light")).toBe("light");
    expect(previewScheme(fern, "dark")).toBe("light");
  });
});
