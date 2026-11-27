/**
 * The model row under the brain popover's choice (ADR 0296): Claude Code's model as Default, Opus,
 * Sonnet or Haiku, and the local brain's Ollama model as a name to type. Each runs
 * `desk.eris.model`, which asking Eris runs too; the row reads the models in force when it opens.
 */
import type { BrainName } from "../bridge/types";
import { CLAUDE_MODELS, MODEL } from "../eris/model";
import type { ShellCtx } from "./context";
import { type Child, h } from "./dom";

const CLAUDE_CHOICES: ReadonlyArray<{ model: string; label: string }> = [
  { model: "", label: "Default" },
  ...CLAUDE_MODELS.map((model) => ({ model, label: model[0]?.toUpperCase() + model.slice(1) })),
];

/** Run desk.eris.model and show the brain it answers with. */
async function choose(ctx: ShellCtx, brain: BrainName, model: string) {
  await ctx.runtime.commands.run(MODEL, { brain, model: model === "" ? "default" : model });
  ctx.store.set({ brain: await ctx.bridge.brain.status() });
}

/** The row for `chosen`, or nothing for a brain without a model, or a host that cannot set one. */
export function brainModelRow(ctx: ShellCtx, chosen: BrainName): Child {
  const models = ctx.bridge.brain.models;
  if (!models || (chosen !== "claude" && chosen !== "local")) return null;
  if (chosen === "claude") {
    const buttons = CLAUDE_CHOICES.map(({ model, label }) =>
      h(
        "button",
        {
          class: "segment",
          type: "button",
          role: "radio",
          "aria-checked": "false",
          "data-key": `claude-model-${model || "default"}`,
          "data-model": model,
          onClick: () => void choose(ctx, "claude", model),
        },
        label,
      ),
    );
    void models.get().then(({ claude }) => {
      for (const button of buttons) {
        const on = button.dataset.model === claude;
        button.classList.toggle("is-selected", on);
        button.setAttribute("aria-checked", String(on));
      }
    });
    return h(
      "div",
      { class: "segmented brain-model", role: "radiogroup", "aria-label": "Claude Code model" },
      buttons,
    );
  }
  const input = h("input", {
    class: "input",
    type: "text",
    "aria-label": "Local model",
    placeholder: "qwen2.5",
    "data-key": "local-model",
  }) as HTMLInputElement;
  void models.get().then(({ local }) => {
    if (!input.value) input.value = local;
  });
  return h(
    "form",
    {
      class: "pop-row brain-model",
      onSubmit: (event: Event) => {
        event.preventDefault();
        if (input.value.trim()) void choose(ctx, "local", input.value.trim());
      },
    },
    input,
    h("button", { class: "btn", type: "submit" }, "Use"),
  );
}
