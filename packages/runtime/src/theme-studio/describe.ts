/**
 * Describe in the theme studio (docs/ko/theme-requirements.md TS-06, TB-04, TB-05): a sentence goes to
 * the brain through brain.ask with propose_theme (prompt.ts). The proposal is cleaned (proposal.ts)
 * and previewed on the whole desk, where the gate fixes what fails, in the scheme it has. The builder
 * applies it (saved as their own theme with the sentences in origin.prompt), refines it with another
 * sentence over it, tunes it in the editor, or discards it. Offline, out of credits or refused,
 * Generate is off and says why; the gallery and the editor keep working.
 */
import type { BrainTurnData, ThemePackage } from "@endue-ai/bridge";
import { compileTheme } from "@endue-ai/ui/theme";
import type { RuntimeThemes, ThemeIo } from "../policies/theme";
import { h, render } from "../shell/dom";
import { type StudioCopy, type StudioLang, studioText } from "./copy";
import { type Scheme, saveTheme } from "./draft";
import { fixesList } from "./fields";
import { describePrompt, oneLine, PROPOSE_THEME } from "./prompt";
import { cleanProposal, type Proposal } from "./proposal";

export interface DescribeDeps {
  themes: RuntimeThemes;
  lang(): StudioLang;
  io(): ThemeIo | undefined;
  /** Show the panel in the studio (its entry, the Describe button, was pressed). */
  open(): void;
  /** Back to the gallery, the theme `id` selected (after Apply). */
  back(id?: string): void;
  /** Open the editor on the proposal, named `name`. */
  tune(theme: ThemePackage, name: string): void;
}

export interface DescribePanel {
  /** The gallery's Describe button. */
  entry: HTMLElement;
  element: HTMLElement;
  /** Draw the panel: `text` in the field (the last one kept otherwise), `colors` added to it, run it. */
  start(options?: { text?: string; colors?: readonly string[]; run?: boolean }): void;
  /** Leave: an answer still coming is dropped and the preview ends. */
  stop(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createDescribe(deps: DescribeDeps): DescribePanel {
  const { themes } = deps;
  const tr = (key: StudioCopy) => studioText(deps.lang(), key);
  let proposal: Proposal | undefined;
  /** The sentences the proposal answers, first to last: its origin.prompt. */
  let said: string[] = [];
  let scheme: Scheme = "dark";
  /** Why Generate is off (offline, no credits, refused); empty while it is on. */
  let blocked = "";
  let line = "";
  let asking = 0;
  let hearing: (() => void) | undefined;

  const element = h("section", {
    class: "theme-describe",
    "aria-labelledby": "theme-describe-title",
  });
  const field = h("input", {
    type: "text",
    class: "theme-describe-input",
    spellcheck: "false",
    "data-key": "describe-sentence",
    onKeydown: (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      void ask(proposal !== undefined);
    },
  });

  const desk = (): Scheme => themes.resolve(themes.active()).scheme;
  const show = (next: Proposal, sentences: string[]) => {
    proposal = next;
    said = sentences;
    // A theme with one scheme is shown in it, and Apply switches the desk to it.
    scheme = next.theme[desk()] ? desk() : next.theme.light ? "light" : "dark";
    themes.previewDraft(next.theme, {}, scheme);
    line = "";
  };

  const hear = (id: number, sentences: string[]) => (turn: BrainTurnData) => {
    if (id !== asking) return;
    if (turn.kind === "started" || turn.kind === "online") {
      blocked = "";
      line = tr("asking");
    } else if (turn.kind === "offline") {
      blocked = tr("offline");
      line = blocked;
    } else if (turn.kind === "error") {
      blocked = tr("refused");
      line = turn.text ? `${blocked}: ${turn.text}` : blocked;
    } else if (turn.kind === "completed") {
      const next = cleanProposal(turn.structured);
      if (next) show(next, sentences);
      else line = tr("noTheme");
    }
    draw();
  };

  const ask = async (refine: boolean) => {
    const sentence = oneLine(field.value);
    if (!sentence || blocked) return;
    const id = ++asking;
    hearing?.();
    const base = refine ? proposal : undefined;
    const sentences = base ? [...said, sentence] : [sentence];
    const active = themes.active();
    const state = themes.resolve(active);
    const name = themes.installed().find((t) => t.id === active)?.name ?? "endue";
    const prompt = describePrompt({
      sentence,
      current: { name, scheme: state.scheme, tokens: state.tokens },
      ...(base ? { proposal: base } : {}),
    });
    line = tr("asking");
    draw();
    try {
      const stop = await themes.brain().ask(prompt, PROPOSE_THEME, hear(id, sentences));
      if (id === asking) hearing = stop;
      else stop();
    } catch (error) {
      if (id !== asking) return;
      line = `${tr("failed")}: ${message(error)}`;
      draw();
    }
  };

  const drop = () => {
    asking++;
    hearing?.();
    hearing = undefined;
    if (proposal) themes.previewDraft(undefined);
    proposal = undefined;
    said = [];
  };

  const apply = async (p: Proposal) => {
    const io = deps.io();
    if (!io) return;
    const theme = { ...p.theme, origin: { prompt: said.join(" → ").slice(0, 2000) } };
    try {
      const entry = { name: p.name || tr("newTheme"), description: p.description, theme };
      const id = await saveTheme(themes, io, entry, { scheme });
      drop();
      deps.back(id);
    } catch (error) {
      line = `${tr("failed")}: ${message(error)}`;
      draw();
    }
  };

  const button = (
    key: string,
    label: StudioCopy,
    onClick: () => void,
    { primary = false, disabled = false } = {},
  ) =>
    h(
      "button",
      {
        type: "button",
        class: `btn ${primary ? "btn-primary" : "btn-outline"}`,
        "data-key": key,
        disabled,
        onClick,
      },
      tr(label),
    );

  const card = (p: Proposal) =>
    h(
      "article",
      { class: "theme-proposal", "aria-label": p.name || tr("newTheme") },
      h("h4", { class: "theme-proposal-name" }, p.name || tr("newTheme")),
      p.description ? h("p", { class: "theme-note" }, p.description) : null,
      h("p", { class: "theme-note theme-proposal-said" }, `${tr("said")}: ${said.join(" → ")}`),
      h(
        "span",
        { class: "theme-swatches", title: tr(scheme) },
        compileTheme(p.theme, scheme).preview.map((color) =>
          h("span", { class: "theme-swatch", style: { "--swatch": color } }),
        ),
      ),
      scheme !== desk()
        ? h("p", { class: "theme-note" }, `${tr("schemeOnly")} (${tr(scheme)})`)
        : null,
      h(
        "section",
        { class: "theme-fixes", "aria-live": "polite" },
        fixesList(themes.state().fixes, tr),
      ),
      h(
        "div",
        { class: "theme-describe-actions" },
        button("describe-apply", "apply", () => void apply(p), {
          primary: true,
          disabled: !deps.io(),
        }),
        button("describe-tune", "tuneIt", () => deps.tune(p.theme, p.name || tr("newTheme"))),
        button("describe-discard", "discard", () => {
          drop();
          line = "";
          draw();
        }),
      ),
      deps.io() ? null : h("p", { class: "theme-note" }, tr("saveLater")),
    );

  const draw = () => {
    field.placeholder = tr("sentenceHint");
    field.setAttribute("aria-label", tr("sentence"));
    render(element, () => [
      h("h3", { class: "theme-describe-title", id: "theme-describe-title" }, tr("describe")),
      h("p", { class: "theme-note" }, tr("describeHint")),
      field,
      h(
        "div",
        { class: "theme-describe-actions" },
        button("describe-back", "back", () => deps.back()),
        button("describe-generate", "generate", () => void ask(false), {
          primary: proposal === undefined,
          disabled: blocked !== "",
        }),
        proposal
          ? button("describe-refine", "refine", () => void ask(true), {
              primary: true,
              disabled: blocked !== "",
            })
          : null,
      ),
      h("p", { class: "theme-describe-status", role: "status" }, line),
      proposal ? card(proposal) : null,
    ]);
  };

  /** Whether the brain can answer now: offline or out of credits turns Generate off. */
  const check = async () => {
    const status = await themes.brain().status();
    if (status?.mode === "offline") blocked = tr("offline");
    else if (status?.mode === "cloud" && status.credits === 0) blocked = tr("noCredits");
    else return;
    line = blocked;
    draw();
  };

  return {
    entry: h(
      "button",
      {
        type: "button",
        class: "btn btn-outline",
        "data-key": "describe",
        onClick: () => deps.open(),
      },
      tr("describe"),
    ),
    element,
    start({ text, colors = [], run = false } = {}) {
      blocked = "";
      line = "";
      if (text !== undefined) field.value = text;
      if (colors.length > 0)
        field.value = [field.value.trim(), `${tr("colorsWord")}: ${colors.join(" ")}`]
          .filter(Boolean)
          .join(" ");
      draw();
      field.focus();
      void check();
      if (run) void ask(false);
    },
    stop() {
      drop();
      line = "";
    },
  };
}
