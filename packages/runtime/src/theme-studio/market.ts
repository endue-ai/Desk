/**
 * The theme studio's Market tab (docs/ko/theme-requirements.md TS-08, ADR 0060): the themes of the
 * markets desk.theme.markets lists, as cards with their preview colours, name, author, licence and how
 * each stands on this desk. Preview downloads a theme through the core, checked against its sha256,
 * and shows it on the whole desk without installing it; Install (Update when the market has another
 * version of one the person has not changed) brings it in through theme.import with its url and
 * sha256; Apply puts an installed one in force. Docked like the editor, so the desk shows the preview.
 */
import type { ThemeBundle, ThemeMarketListResult, ThemeMarketTheme } from "@endue-ai/bridge";
import type { RuntimeThemes } from "../policies/theme";
import { h, render } from "../shell/dom";
import type { StudioCopy } from "./copy";
import type { Scheme } from "./draft";

export interface MarketDeps {
  themes: RuntimeThemes;
  tr(key: StudioCopy): string;
  /** Show the tab in the studio (its entry, the Market button, was pressed); it then reads the markets. */
  open(): void;
  /** Back to the gallery, the theme `id` selected (one just applied). */
  back(id?: string): void;
}

export interface MarketPanel {
  /** The gallery's Market button. */
  entry: HTMLElement;
  element: HTMLElement;
  /** Draw the tab and read the markets again. */
  start(): void;
  /** Leave: the preview ends. */
  stop(): void;
}

const MEDIA: Record<string, string> = {
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** A bundle's files as data: URLs by path, so a preview needs nothing installed. */
export function bundleFiles(bundle: ThemeBundle): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const [path, base64] of Object.entries(bundle.files)) {
    const type = MEDIA[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    urls[path] = `data:${type};base64,${base64}`;
  }
  return urls;
}

/** The scheme to preview a theme in: the desk's when the theme has it, else the one it has. */
export function previewScheme(bundle: ThemeBundle, current: Scheme): Scheme {
  const theme = bundle.manifest.theme;
  if (!theme || theme[current]) return current;
  return current === "dark" ? "light" : "dark";
}

const STATE: Record<ThemeMarketTheme["state"], StudioCopy> = {
  available: "available",
  installed: "installed",
  update: "updateAvailable",
  edited: "edited",
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createMarket(deps: MarketDeps): MarketPanel {
  const { themes, tr } = deps;
  let listed: ThemeMarketListResult | undefined;
  let loading = false;
  let busy = false;
  let previewing: string | undefined;
  let reads = 0;
  const element = h("section", { class: "theme-market", "aria-labelledby": "theme-market-title" });
  const note = h("p", { class: "theme-note theme-market-note", role: "status" });

  const read = async () => {
    const read = ++reads;
    loading = true;
    draw();
    try {
      const result = await themes.market().list();
      // The look markets list design systems too; the design system studio shows those (ADR 0091).
      const own = result.themes.filter((entry) => (entry.theme.kind ?? "theme") === "theme");
      if (read === reads) listed = { ...result, themes: own };
    } catch (error) {
      if (read === reads) note.textContent = `${tr("failed")}: ${message(error)}`;
    }
    if (read === reads) loading = false;
    draw();
  };

  /** Run one card's action, the others off until it ends; says how it went in the note. */
  const act = async (label: StudioCopy, task: () => Promise<string>) => {
    if (busy) return;
    busy = true;
    note.textContent = `${tr(label)}…`;
    draw();
    try {
      note.textContent = await task();
    } catch (error) {
      note.textContent = `${tr("failed")}: ${message(error)}`;
    }
    busy = false;
    draw();
  };

  const preview = (item: ThemeMarketTheme) =>
    act("downloading", async () => {
      const bundle = await themes.market().fetch(item.theme.url, item.theme.sha256);
      const theme = bundle.manifest.theme;
      if (!theme) throw new Error(`${item.theme.id} is not a theme`);
      const scheme = previewScheme(bundle, themes.state().scheme);
      themes.previewDraft(theme, bundleFiles(bundle), scheme);
      previewing = item.theme.id;
      return `${tr("previewing")}: ${item.theme.name}`;
    });

  const install = (item: ThemeMarketTheme) =>
    act("installing", async () => {
      const { url, sha256 } = item.theme;
      await themes.market().install({ url, sha256, market: item.market });
      void read();
      return `${tr("installed")}: ${item.theme.name}`;
    });

  /** Put an installed theme in force and go back to the gallery, where it shows as applied. */
  const apply = (id: string) => {
    themes.apply(id);
    deps.back(id);
  };

  const button = (key: string, label: StudioCopy, onClick: () => void, primary = false) =>
    h(
      "button",
      {
        type: "button",
        class: `btn ${primary ? "btn-primary" : "btn-outline"} btn-xs`,
        "data-key": key,
        "aria-disabled": String(busy),
        onClick,
      },
      tr(label),
    );

  const card = (item: ThemeMarketTheme) => {
    const { theme, state } = item;
    const applied = themes.active() === theme.id;
    const installable = state === "available" || state === "update";
    return h(
      "article",
      {
        class: `theme-market-card${previewing === theme.id ? " is-previewing" : ""}`,
        role: "listitem",
        "data-theme": theme.id,
        "data-state": state,
        "aria-label": theme.name,
      },
      h(
        "span",
        { class: "theme-market-swatches", "aria-hidden": "true" },
        theme.preview.map((color) => h("span", { style: { "--swatch": color } })),
      ),
      h(
        "span",
        { class: "theme-market-text" },
        h(
          "span",
          { class: "theme-market-name" },
          theme.name,
          h("span", { class: "theme-market-version" }, theme.version),
          h("span", { class: `theme-market-state is-${state}` }, tr(STATE[state])),
        ),
        h("span", { class: "theme-market-meta" }, `${tr("by")} ${theme.author} · ${theme.license}`),
        theme.description
          ? h("span", { class: "theme-market-description" }, theme.description)
          : null,
      ),
      h(
        "span",
        { class: "theme-market-actions" },
        button("market-preview", "preview", () => void preview(item)),
        installable
          ? button(
              "market-install",
              state === "update" ? "update" : "install",
              () => void install(item),
              true,
            )
          : null,
        state === "available"
          ? null
          : applied
            ? h("span", { class: "theme-card-badge" }, tr("applied"))
            : button("market-apply", "apply", () => apply(theme.id), !installable),
      ),
    );
  };

  /** Draw the tab again, focus kept on the same control of the same card. */
  const draw = () => {
    const active = document.activeElement;
    const kept = active instanceof HTMLElement && element.contains(active) ? active : undefined;
    const key = kept?.dataset.key;
    const owner = kept?.closest<HTMLElement>("[data-theme]")?.dataset.theme;
    const themesListed = listed?.themes ?? [];
    render(element, () => [
      h("h3", { class: "theme-market-title", id: "theme-market-title" }, tr("market")),
      h("p", { class: "theme-note" }, tr("marketHint")),
      h(
        "div",
        { class: "theme-market-list", role: "list", "aria-busy": String(loading) },
        loading && !listed
          ? h("p", { class: "theme-empty" }, tr("marketLoading"))
          : themesListed.length === 0
            ? h("p", { class: "theme-empty" }, tr("marketEmpty"))
            : themesListed.map(card),
      ),
      (listed?.problems ?? []).map((p) =>
        h(
          "p",
          { class: "theme-note theme-market-problem" },
          `${tr("marketProblem")}: ${p.market} (${p.message})`,
        ),
      ),
      note,
      h(
        "div",
        { class: "theme-brand-actions" },
        button("market-back", "back", () => deps.back()),
      ),
    ]);
    const within = owner ? `[data-theme="${owner}"] ` : "";
    if (key) element.querySelector<HTMLElement>(`${within}[data-key="${key}"]`)?.focus();
  };

  const start = () => {
    note.textContent = "";
    draw();
    element.querySelector<HTMLElement>('[data-key="market-back"]')?.focus();
    // Once the cards are in, focus moves to the first one's Preview unless the person moved it.
    void read().then(() => {
      const back = element.querySelector('[data-key="market-back"]');
      if (document.activeElement === back)
        element.querySelector<HTMLElement>('[data-key="market-preview"]')?.focus();
    });
  };

  return {
    entry: h(
      "button",
      {
        type: "button",
        class: "btn btn-outline",
        "data-key": "market",
        onClick: () => {
          deps.open();
          start();
        },
      },
      tr("market"),
    ),
    element,
    start,
    stop() {
      if (previewing !== undefined) themes.previewDraft(undefined);
      previewing = undefined;
    },
  };
}
