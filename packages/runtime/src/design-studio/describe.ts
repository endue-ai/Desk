/**
 * Describe a design system in a sentence (DS-06, DE-03): the sentence goes to the brain with the
 * propose_design_system tool (brain.ask, ADR 0059); the answer is cleaned, previewed on the whole desk,
 * then applied (saved as the person's own, `origin.prompt` holding the sentences), refined with another
 * sentence, tuned in the editor or discarded. Offline or out of credits, Generate is off and says so.
 */
import type { BrainTurnData, DesignSystemPackage } from "@endue-ai/bridge";
import type { DesignRecipe } from "@endue-ai/ui/design";
import { localDesignId, type RuntimeDesigns } from "../policies/design";
import type { ThemeBrain } from "../policies/theme";
import { h } from "../shell/dom";
import type { StudioLang } from "../theme-studio/copy";
import { type DesignCopy, designText } from "./copy";
import { cleanDesignProposal, designPrompt, PROPOSE_DESIGN } from "./prompt";

export interface DesignDescribeDeps {
  designs: RuntimeDesigns;
  brain(): ThemeBrain | undefined;
  lang(): StudioLang;
  back(id?: string): void;
  tune(made: { name: string; designSystem: DesignSystemPackage }): void;
  /** Hand the sentence back to Eris's conversation. */
  toEris(text: string): void;
}

export interface DesignDescribe {
  readonly element: HTMLElement;
  /** Open with `text` in the field; `run` generates at once, `fromEris` offers to send it back. */
  start(options?: { text?: string; run?: boolean; fromEris?: boolean }): void;
  stop(): void;
}

type Proposal = { name: string; description: string; components: DesignRecipe };

export function createDesignDescribe(deps: DesignDescribeDeps): DesignDescribe {
  const { designs } = deps;
  const tr = (key: DesignCopy) => designText(deps.lang(), key);
  let proposal: Proposal | undefined;
  let sentences: string[] = [];
  let stopTurn: (() => void) | undefined;
  const field = h("textarea", {
    class: "input design-describe-text",
    rows: "3",
    "data-key": "design-sentence",
  });
  const status = h("p", { class: "theme-note", role: "status" });
  const result = h("div", { class: "design-describe-result" });
  const toEris = h(
    "button",
    {
      type: "button",
      class: "btn btn-outline",
      hidden: true,
      onClick: () => deps.toEris(field.value),
    },
    tr("toEris"),
  );
  const generate = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary",
      "data-key": "design-generate",
      onClick: () => void run(),
    },
    tr("generate"),
  );

  const packageOf = (p: Proposal): DesignSystemPackage => ({
    origin: { prompt: sentences.join("\n").slice(0, 2000) },
    components: p.components,
  });
  const show = () => {
    result.replaceChildren();
    if (!proposal) return;
    const p = proposal;
    const button = (key: DesignCopy, cls: string, onClick: () => void) =>
      h(
        "button",
        { type: "button", class: `btn ${cls}`, "data-key": `design-${key}`, onClick },
        tr(key),
      );
    result.append(
      h("p", { class: "theme-card-name" }, p.name),
      h("p", { class: "theme-card-description" }, p.description),
      h(
        "div",
        { class: "theme-gallery-actions" },
        button("apply", "btn-primary", () => void apply(p)),
        button("tune", "btn-outline", () =>
          deps.tune({ name: p.name, designSystem: packageOf(p) }),
        ),
        button("discard", "btn-outline", () => {
          proposal = undefined;
          designs.previewDraft(undefined);
          show();
        }),
      ),
    );
  };
  const apply = async (p: Proposal) => {
    const taken = (id: string) => designs.installed().some((d) => d.id === id);
    const id = localDesignId(p.name, taken);
    try {
      await designs.io().save({
        id,
        name: p.name,
        ...(p.description ? { description: p.description } : {}),
        designSystem: packageOf(p),
      });
      designs.previewDraft(undefined);
      designs.apply(id);
      deps.back(id);
    } catch (error) {
      status.textContent = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const hear = (turn: BrainTurnData) => {
    if (turn.kind === "offline") {
      status.textContent = tr("offline");
      generate.disabled = true;
    } else if (turn.kind === "error") {
      status.textContent = `${tr("failed")}${turn.text ? `: ${turn.text}` : ""}`;
      generate.disabled = false;
    } else if (turn.kind === "completed") {
      generate.disabled = false;
      const next = cleanDesignProposal(turn.structured);
      if (!next) {
        status.textContent = tr("noAnswer");
        return;
      }
      proposal = next;
      status.textContent = "";
      designs.previewDraft(packageOf(next));
      show();
    }
  };
  const run = async () => {
    const sentence = field.value.trim();
    const brain = deps.brain();
    if (!sentence || !brain) return;
    stopTurn?.();
    sentences = proposal ? [...sentences, sentence] : [sentence];
    generate.disabled = true;
    status.textContent = tr("thinking");
    const prompt = designPrompt(sentence, designs.resolve(designs.active()).recipe, proposal);
    try {
      stopTurn = await brain.ask(prompt, PROPOSE_DESIGN, hear);
    } catch (error) {
      generate.disabled = false;
      status.textContent = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const element = h(
    "div",
    { class: "design-describe" },
    h(
      "label",
      { class: "design-editor-choice" },
      h("span", { class: "field-label" }, tr("sentence")),
      field,
    ),
    h(
      "div",
      { class: "theme-gallery-actions" },
      generate,
      toEris,
      h(
        "button",
        { type: "button", class: "btn btn-outline", onClick: () => deps.back() },
        tr("back"),
      ),
    ),
    status,
    result,
  );
  return {
    element,
    start(options = {}) {
      field.placeholder = tr("placeholder");
      field.value = options.text ?? "";
      toEris.hidden = !options.fromEris;
      proposal = undefined;
      status.textContent = "";
      generate.disabled = false;
      show();
      void deps
        .brain()
        ?.status()
        .then((s) => {
          if (s && (s.mode === "offline" || (s.mode === "cloud" && s.credits === 0))) {
            generate.disabled = true;
            status.textContent = tr("offline");
          } else if (options.run && options.text) void run();
        });
      if (!deps.brain()) status.textContent = tr("offline");
    },
    stop() {
      stopTurn?.();
      stopTurn = undefined;
      designs.previewDraft(undefined);
    },
  };
}
