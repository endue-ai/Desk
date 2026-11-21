/**
 * Eris's model (ADR 0094, ADR 0296): which brain she thinks with and, for Claude Code and the local
 * brain, which model. The person picks it in the rail's brain popover, from the palette
 * ("Use model…"), or by asking her: "switch to Sonnet", "use qwen2.5 locally". Both run
 * `desk.eris.model`, which writes the runtime's settings the core reads on every turn
 * (`brain.use`, `brain.model` for the local brain, `brain.claude-model` for Claude Code), so the
 * next turn already uses the new one. `desk.eris.models` says what is in force and what she can use.
 */
import type { BrainName, BrainStatus } from "../bridge/types";
import type { ShellCtx } from "../shell/context";

export const MODEL = "desk.eris.model";
export const MODELS = "desk.eris.models";

/** Claude Code's own model aliases; any other claude-* id it knows works too. */
export const CLAUDE_MODELS = ["opus", "sonnet", "haiku"] as const;
const BRAINS: readonly BrainName[] = ["endue", "claude", "local", "echo"];

export interface ModelChoice {
  brain: BrainName;
  /** Claude Code's or the local brain's model; none keeps the one set (Claude Code: its own). */
  model?: string;
}

const clean = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * What a person or an agent names, as a brain and model: "endue", "echo", "claude" or "claude
 * code", "opus" / "sonnet" / "haiku" / "claude-…" (Claude Code), "local" (the local brain as set),
 * "local:qwen2.5" or "claude:sonnet", and any other name as a local (Ollama) model. Undefined for
 * nothing named.
 */
export function modelChoiceOf(named: string, brain?: string): ModelChoice | undefined {
  const text = named.trim();
  const said = clean(text);
  const asked = brain ? clean(brain) : undefined;
  if (asked && (BRAINS as readonly string[]).includes(asked)) {
    const b = asked as BrainName;
    if (b === "endue" || b === "echo" || said === "") return { brain: b };
    if (b === "claude" && said === "default") return { brain: "claude", model: "" };
    return { brain: b, model: text };
  }
  if (said === "") return undefined;
  if (said === "endue" || said === "endue ai") return { brain: "endue" };
  if (said === "echo") return { brain: "echo" };
  if (said === "claude" || said === "claude code") return { brain: "claude" };
  if (said === "local" || said === "ollama") return { brain: "local" };
  const prefixed = /^(claude|local|ollama):\s*(.+)$/i.exec(text);
  if (prefixed?.[1] && prefixed[2]) {
    const b = prefixed[1].toLowerCase() === "claude" ? "claude" : "local";
    return { brain: b, model: prefixed[2].trim() };
  }
  if ((CLAUDE_MODELS as readonly string[]).includes(said) || said.startsWith("claude-"))
    return { brain: "claude", model: said };
  return { brain: "local", model: text };
}

/** The brain and models in force, as Eris and the popover read them. */
export interface ModelsInForce {
  brain: BrainName;
  local: string;
  claude: string;
  fallback: boolean;
}

/** The brain a status names; a host that cannot say is on endue or the local one. */
export const brainOf = (status: BrainStatus): BrainName =>
  status.brain ?? (status.mode === "local" ? "local" : "endue");

async function inForce(ctx: ShellCtx): Promise<ModelsInForce> {
  const status = await ctx.bridge.brain.status();
  const models = (await ctx.bridge.brain.models?.get()) ?? { local: "", claude: "" };
  return {
    brain: brainOf(status),
    local: models.local || (status.mode === "local" ? status.model : ""),
    claude: models.claude,
    fallback: status.mode === "local" && status.fallback === true,
  };
}

/** Switch Eris to `choice`: the model first, so the brain's next turn starts on it. */
export async function useModel(ctx: ShellCtx, choice: ModelChoice): Promise<BrainStatus> {
  const { brain } = ctx.bridge;
  if (choice.model !== undefined && (choice.brain === "local" || choice.brain === "claude")) {
    if (!brain.models) throw new Error("This desk cannot change the model.");
    if (choice.brain === "local" && choice.model.trim() === "")
      throw new Error("Name the local model, for example qwen2.5.");
    await brain.models.set(choice.brain, choice.model.trim());
  }
  const status = await brain.use(choice.brain);
  ctx.store.set({ brain: status });
  return status;
}

const NAMES: Record<BrainName, string> = {
  endue: "endue AI",
  claude: "Claude Code",
  local: "the local brain",
  echo: "the echo brain",
};

/** "Claude Code (sonnet)", "the local brain (qwen2.5)", "endue AI". */
export function modelName(brain: BrainName, models: { local: string; claude: string }): string {
  const model = brain === "local" ? models.local : brain === "claude" ? models.claude : "";
  return model ? `${NAMES[brain]} (${model})` : NAMES[brain];
}

export function defineModelCommands(ctx: ShellCtx): () => void {
  const { commands } = ctx.runtime;
  if (!commands) return () => {};
  const offs = [
    commands.define(MODEL, {
      title: () => "Use model…",
      keywords: ["model", "brain", "eris", "claude", "opus", "sonnet", "haiku", "ollama", "모델"],
      owner: "desk",
      run: async (args) => {
        const { model, brain } = (args ?? {}) as { model?: unknown; brain?: unknown };
        const choice = modelChoiceOf(
          typeof model === "string" ? model : "",
          typeof brain === "string" ? brain : undefined,
        );
        if (!choice) throw new Error("Name a model or a brain: sonnet, endue, local:qwen2.5.");
        await useModel(ctx, choice);
        const now = await inForce(ctx);
        return { ...now, said: `Eris now thinks with ${modelName(now.brain, now)}.` };
      },
      agent: {
        description:
          "Change the model you (Eris) think with, when the person asks for another model or brain. brain: endue (endue AI), claude (the person's Claude Code), local (Ollama on this computer) or echo. model: for claude an alias (opus, sonnet, haiku) or a claude-* id, or default for Claude Code's own; for local the Ollama model (qwen2.5, llama3.2). Or give model alone as the person said it (sonnet, local:qwen2.5). The next turn uses it; tell the person which one is in force.",
        args: {
          type: "object",
          properties: {
            brain: { type: "string", enum: [...BRAINS] },
            model: { type: "string", description: "The model, or what the person called it." },
          },
          additionalProperties: false,
        },
      },
    }),
    commands.define(MODELS, {
      title: () => "Which model Eris uses",
      keywords: ["model", "brain", "eris", "모델"],
      owner: "desk",
      run: async () => {
        const now = await inForce(ctx);
        return {
          ...now,
          brains: BRAINS,
          claudeModels: CLAUDE_MODELS,
          said: `Eris thinks with ${modelName(now.brain, now)}.`,
        };
      },
      agent: {
        description:
          "Which brain and model you (Eris) think with now, and the ones you can switch to with desk.eris.model.",
        readOnly: true,
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
