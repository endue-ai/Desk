/**
 * The theme studio's editor (TS-03 to TS-05): a draft of a theme, tuned layer by layer while the whole
 * desk previews it, with the contrast gate's fixes listed beside the palette. Saving, exporting,
 * importing and deleting go through the core's theme.* methods when the runtime has them (`io`).
 */
import type { ThemePackage } from "@endue-ai/bridge";
import type { RuntimeThemes, ThemeIo } from "../policies/theme";
import { h, render } from "../shell/dom";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import { draftFrom, type Scheme, saveTheme } from "./draft";
import { base64, fixesList, textField } from "./fields";
import {
  backdropSection,
  materialSection,
  paletteSection,
  type SectionContext,
  shapeMotionSection,
  typeSection,
} from "./sections";

export type { ThemeIo } from "../policies/theme";

export interface EditorDeps {
  themes: RuntimeThemes;
  lang(): StudioLang;
  io(): ThemeIo | undefined;
  /** Back to the gallery, the theme `id` selected (after a save, say). */
  back(id?: string): void;
}

export interface Editor {
  element: HTMLElement;
  /** Start from an installed theme (a copy, or the theme itself when it is the person's own). */
  start(base: string | undefined, scheme: Scheme): void;
  /** Start a new theme from a ready block (a palette from a brand image, say), named `name`. */
  startDraft(theme: ThemePackage, scheme: Scheme, name?: string): void;
  stop(): void;
}

const MEDIA: Record<string, string> = {
  woff2: "font/woff2",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function createEditor(deps: EditorDeps): Editor {
  const { themes } = deps;
  const tr = (key: StudioCopy) => studioText(deps.lang(), key);
  const files = new Map<string, { base64: string; url: string }>();
  let draft: ThemePackage = draftFrom();
  let scheme: Scheme = "dark";
  let name = "";
  let description = "";
  let own: string | undefined;
  let base: string | undefined;
  let note = "";
  let confirming = false;
  let removing = false;

  const element = h("div", { class: "theme-editor" });
  const body = h("div", { class: "theme-editor-body" });
  const fixesEl = h("section", { class: "theme-fixes", "aria-live": "polite" });
  const status = h("p", { class: "theme-editor-status", role: "status" });

  let baseUrl: ((path: string) => string) | undefined;
  // New files as data: URLs; the rest from the theme the draft started from.
  const urls = () => {
    const known: Record<string, string> = {};
    const paths = [
      ...(draft.type?.fonts ?? []).map((f) => f.src),
      draft.light?.backdrop?.image,
      draft.dark?.backdrop?.image,
    ].filter((p): p is string => typeof p === "string");
    for (const path of paths) if (baseUrl) known[path] = baseUrl(path);
    for (const [path, f] of files) known[path] = f.url;
    return known;
  };
  const preview = () => themes.previewDraft(draft, urls(), scheme);

  const drawFixes = () => render(fixesEl, () => fixesList(themes.state().fixes, tr));

  const context = (): SectionContext => ({
    draft,
    scheme,
    tokens: themes.state().tokens,
    tr,
    addFile(path, bytes) {
      const ext = path.split(".").pop() ?? "";
      const encoded = base64(bytes);
      files.set(path, {
        base64: encoded,
        url: `data:${MEDIA[ext] ?? "application/octet-stream"};base64,${encoded}`,
      });
    },
    changed(rerender = false) {
      preview();
      if (rerender) drawBody();
      drawFixes();
    },
  });

  const drawBody = () => {
    const c = context();
    render(body, () => [
      paletteSection(c),
      materialSection(c),
      typeSection(c),
      shapeMotionSection(c),
      backdropSection(c),
    ]);
  };

  const run = async (label: StudioCopy, task: () => Promise<string | undefined>) => {
    status.textContent = "";
    try {
      const detail = await task();
      status.textContent = detail ? `${tr(label)}: ${detail}` : tr(label);
    } catch (error) {
      status.textContent = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  const save = () =>
    run("saved", async () => {
      const io = deps.io();
      if (!io) return undefined;
      const title = name || tr("newTheme");
      own = await saveTheme(
        themes,
        io,
        { name: title, description, theme: draft },
        {
          files: [...files].map(([path, f]) => ({ path, base64: f.base64 })),
          ...(base ? { copyFrom: base } : {}),
          ...(own ? { keep: own } : {}),
        },
      );
      deps.back(own);
      return title;
    });

  const draw = () => {
    const io = deps.io();
    const tab = (s: Scheme) =>
      h(
        "button",
        {
          type: "button",
          role: "tab",
          class: `theme-tab${s === scheme ? " is-on" : ""}`,
          "aria-selected": String(s === scheme),
          "data-key": `scheme-${s}`,
          onClick: () => {
            scheme = s;
            preview();
            draw();
          },
        },
        tr(s),
      );
    render(element, () => [
      h(
        "div",
        { class: "theme-editor-head" },
        textField(
          tr("name"),
          name,
          (v) => {
            name = v.trim();
          },
          "theme-name",
          tr("newTheme"),
        ),
        textField(
          tr("description"),
          description,
          (v) => {
            description = v.trim();
          },
          "theme-description",
        ),
        h(
          "div",
          { class: "theme-tabs", role: "tablist", "aria-label": tr("palette") },
          tab("light"),
          tab("dark"),
        ),
      ),
      body,
      fixesEl,
      h(
        "div",
        { class: "theme-editor-actions" },
        confirming
          ? [
              h("p", { class: "theme-editor-confirm" }, tr("removeConfirm")),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-outline",
                  "data-key": "editor-cancel-remove",
                  disabled: removing,
                  onClick: () => cancelRemove(),
                },
                tr("cancel"),
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-danger",
                  disabled: removing,
                  onClick: () => {
                    if (!io || !own || removing) return;
                    removing = true;
                    draw();
                    void run("removed", async () => {
                      await io.remove(own as string);
                      themes.apply("");
                      deps.back("");
                      return undefined;
                    }).finally(() => {
                      removing = false;
                      if (confirming) draw();
                    });
                  },
                },
                tr("remove"),
              ),
            ]
          : [
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-outline",
                  "data-key": "editor-back",
                  onClick: () => deps.back(),
                },
                tr("back"),
              ),
              h(
                "button",
                {
                  type: "button",
                  class: "btn btn-primary",
                  "data-key": "editor-save",
                  disabled: !io,
                  onClick: () => void save(),
                },
                tr("save"),
              ),
              own && io
                ? h(
                    "button",
                    {
                      type: "button",
                      class: "btn btn-outline",
                      "data-key": "editor-export",
                      onClick: () => void run("exported", () => io.exportTheme(own as string)),
                    },
                    tr("export"),
                  )
                : null,
              own && io
                ? h(
                    "button",
                    {
                      type: "button",
                      class: "btn btn-danger",
                      "data-key": "editor-remove",
                      onClick: () => {
                        confirming = true;
                        draw();
                        element
                          .querySelector<HTMLButtonElement>('[data-key="editor-cancel-remove"]')
                          ?.focus();
                      },
                    },
                    tr("remove"),
                  )
                : null,
            ],
        status,
      ),
      io ? null : h("p", { class: "theme-note" }, tr("saveLater")),
      note ? h("p", { class: "theme-note" }, note) : null,
    ]);
    drawBody();
    drawFixes();
  };

  const cancelRemove = () => {
    if (removing) return;
    confirming = false;
    draw();
    element.querySelector<HTMLButtonElement>('[data-key="editor-remove"]')?.focus();
  };

  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !confirming) return;
    event.preventDefault();
    event.stopPropagation();
    cancelRemove();
  });

  const begin = (theme: ThemePackage | undefined, start: Scheme) => {
    draft = draftFrom(theme);
    scheme = start;
    files.clear();
    note = "";
    confirming = false;
    preview();
    draw();
  };

  return {
    element,
    start(from, start) {
      const installed = themes.installed().find((t) => t.id === from);
      base = installed?.id;
      baseUrl = installed?.url;
      own = from?.startsWith("local.") ? from : undefined;
      name = own ? (installed?.name ?? "") : installed ? `${installed.name} 2` : "";
      description = installed?.description ?? "";
      begin(installed?.theme, start);
    },
    startDraft(theme, start, title = "") {
      base = undefined;
      baseUrl = undefined;
      own = undefined;
      name = title;
      description = "";
      begin(theme, start);
    },
    stop() {
      confirming = false;
      themes.previewDraft(undefined);
      files.clear();
    },
  };
}
