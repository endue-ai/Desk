/**
 * The design system studio's Market tab (DS-05): the design systems the look markets list
 * (`desk.theme.markets`, entries of kind design-system, ADR 0091). Preview downloads one, checks its
 * sha256 and shows it on the whole desk; Install brings it in (theme.import by url). Nothing installs
 * on a preview.
 */
import type { ThemeMarketTheme } from "@endue-ai/bridge";
import { compileDesignSystem } from "@endue-ai/ui/design";
import type { RuntimeDesigns } from "../policies/design";
import { h } from "../shell/dom";
import type { StudioLang } from "../theme-studio/copy";
import { specimen } from "./card";
import { type DesignCopy, designText } from "./copy";

export interface DesignMarketDeps {
  designs: RuntimeDesigns;
  lang(): StudioLang;
  back(id?: string): void;
}

export interface DesignMarketTab {
  readonly element: HTMLElement;
  start(): void;
  stop(): void;
}

export function createDesignMarket(deps: DesignMarketDeps): DesignMarketTab {
  const { designs } = deps;
  const tr = (key: DesignCopy) => designText(deps.lang(), key);
  const list = h("div", { class: "design-market-list", role: "list" });
  const note = h("p", { class: "theme-note", role: "status" });
  let previewed: string | undefined;
  const fail = (error: unknown) => {
    note.textContent = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
  };
  const row = (listed: ThemeMarketTheme) => {
    const { theme: entry, market } = listed;
    const shown = h("span", { class: "design-market-specimen" });
    const installed = listed.state === "installed";
    return h(
      "div",
      { class: "theme-card design-market-item", role: "listitem", "data-design": entry.id },
      shown,
      h(
        "span",
        { class: "theme-card-text" },
        h("span", { class: "theme-card-name" }, entry.name),
        h("span", { class: "theme-card-author" }, `${tr("by")} ${entry.author}`),
        h("span", { class: "theme-card-description" }, entry.description ?? ""),
        h(
          "span",
          { class: "theme-gallery-actions" },
          h(
            "button",
            {
              type: "button",
              class: "btn btn-outline",
              "data-key": `preview-${entry.id}`,
              onClick: async () => {
                try {
                  const design = await designs.market().fetch(entry.url, entry.sha256);
                  previewed = entry.id;
                  shown.replaceChildren(
                    specimen(compileDesignSystem(design.components), deps.lang()),
                  );
                  designs.previewDraft(design);
                } catch (error) {
                  fail(error);
                }
              },
            },
            tr("preview"),
          ),
          h(
            "button",
            {
              type: "button",
              class: "btn btn-primary",
              "data-key": `install-${entry.id}`,
              disabled: installed,
              onClick: async () => {
                try {
                  const id = await designs
                    .market()
                    .install({ url: entry.url, sha256: entry.sha256, market });
                  designs.previewDraft(undefined);
                  deps.back(id);
                } catch (error) {
                  fail(error);
                }
              },
            },
            installed ? tr("installed") : listed.state === "update" ? tr("update") : tr("install"),
          ),
        ),
      ),
    );
  };
  const element = h(
    "div",
    { class: "design-market" },
    list,
    note,
    h(
      "div",
      { class: "theme-gallery-actions" },
      h(
        "button",
        { type: "button", class: "btn btn-outline", onClick: () => deps.back() },
        tr("back"),
      ),
    ),
  );
  return {
    element,
    start() {
      note.textContent = tr("loading");
      list.replaceChildren();
      designs
        .market()
        .list()
        .then(({ designs: found, problems }) => {
          note.textContent = found.length === 0 ? tr("marketEmpty") : problems.join("; ");
          list.replaceChildren(...found.map(row));
        })
        .catch(fail);
    },
    stop() {
      if (previewed !== undefined) designs.previewDraft(undefined);
      previewed = undefined;
    },
  };
}
