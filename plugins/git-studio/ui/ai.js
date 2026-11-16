// AI through the desk's brain (brain.ask, under brain:ask): each question goes with a tool whose
// arguments are the answer, so nothing is read out of prose. The prompts carry what git says (the
// staged diff, a commit, a conflict, a branch's commits), cut to fit; the answer is checked before use.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {{ name: string, description: string, schema: Record<string, unknown> }} Tool
 */

export const SCOPE = Object.freeze({ permission: "brain:ask" });
const PROMPT_MAX = 30_000;
const WAIT_MS = 120_000;

/** Cut `text` to `max` characters, saying so at the cut. */
export function clip(/** @type {string} */ text, max = 18_000) {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}\n… (${text.length - max} more characters cut)`;
}

/** @param {Pick<PluginBridge, "call" | "onEvent">} bridge */
export function createAsker(bridge) {
  /** @type {Map<string, { resolve(v: Record<string, unknown> | null): void, reject(e: Error): void, timer: ReturnType<typeof setTimeout> }>} */
  const waiting = new Map();
  /** Turns that answered before their id came back. @type {Map<string, any>} */
  const early = new Map();
  const settle = (/** @type {any} */ data) => {
    const turn = waiting.get(data.turnId);
    if (!turn) return false;
    if (data.kind === "completed") turn.resolve(data.structured ?? null);
    else if (data.kind === "error")
      turn.reject(new Error(data.text || "The brain could not answer."));
    else return true;
    clearTimeout(turn.timer);
    waiting.delete(data.turnId);
    return true;
  };
  bridge.onEvent((event) => {
    if (event.event !== "brain.turn") return;
    const data = /** @type {any} */ (event.data);
    if (data.kind === "offline" && waiting.has(data.turnId)) {
      const turn = waiting.get(data.turnId);
      clearTimeout(turn?.timer);
      waiting.delete(data.turnId);
      turn?.reject(new Error(data.text || "The brain is offline."));
      return;
    }
    if (
      !settle(data) &&
      (data.kind === "completed" || data.kind === "error" || data.kind === "offline")
    )
      early.set(data.turnId, data);
  });

  /**
   * Ask once; resolves with the tool's arguments, or null when the brain answered in words.
   * @param {string} prompt @param {Tool} tool
   */
  async function ask(prompt, tool) {
    let turnId;
    try {
      ({ turnId } = await bridge.call("brain.ask", {
        prompt: prompt.slice(0, PROMPT_MAX),
        tool,
        scope: { ...SCOPE },
      }));
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code === "permission_denied")
        throw new Error("Git Studio may not ask the brain: allow it in the plugin's permissions.");
      if (code === "unsupported") throw new Error("This desk has no brain to ask.");
      throw new Error(`Could not ask the brain: ${code ?? "error"}.`);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        waiting.delete(turnId);
        reject(new Error("The brain took too long to answer."));
      }, WAIT_MS);
      waiting.set(turnId, { resolve, reject, timer });
      const kept = early.get(turnId);
      if (kept) {
        early.delete(turnId);
        if (kept.kind === "offline") {
          clearTimeout(timer);
          waiting.delete(turnId);
          reject(new Error(kept.text || "The brain is offline."));
        } else settle(kept);
      }
    });
  }
  return { ask };
}

/** @typedef {ReturnType<typeof createAsker>} Asker */

export const COMMIT_TOOL = Object.freeze({
  name: "write_commit_message",
  description: "Give the commit message for the staged changes.",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        maxLength: 72,
        description: "The first line: imperative, at most 72 characters, no period at the end.",
      },
      body: {
        type: "string",
        description:
          "Why the change was made and what it does, wrapped at 72 characters; empty when the summary says it all.",
      },
    },
    required: ["summary", "body"],
    additionalProperties: false,
  },
});

/** The prompt for a commit message: the staged diff, and the repository's own recent style. */
export function commitPrompt(
  /** @type {{ diff: string, stat: string, branch: string | null, recent: string[] }} */ input,
) {
  return [
    "Write the commit message for these staged changes.",
    "Follow the style of the repository's recent commit subjects (for example a Conventional Commits prefix when they use one).",
    "Describe what changes and why; do not list every file.",
    `Branch: ${input.branch ?? "(detached)"}`,
    `Recent subjects:\n${input.recent.map((s) => `- ${s}`).join("\n") || "(none)"}`,
    `Files:\n${input.stat}`,
    `Staged diff:\n${clip(input.diff)}`,
  ].join("\n\n");
}

export const EXPLAIN_TOOL = Object.freeze({
  name: "explain_commit",
  description: "Explain what a commit does, for a reviewer.",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Two or three sentences: what the commit changes and why it matters.",
      },
      points: {
        type: "array",
        items: { type: "string" },
        maxItems: 6,
        description: "The notable changes, one short line each.",
      },
      risk: {
        type: "string",
        enum: ["low", "medium", "high"],
        description: "How likely the change is to break something.",
      },
      riskReason: { type: "string", description: "One sentence on why that risk." },
    },
    required: ["summary", "points", "risk", "riskReason"],
    additionalProperties: false,
  },
});

export function explainPrompt(
  /** @type {{ message: string, author: string, show: string }} */ input,
) {
  return [
    "Explain this commit to someone reviewing the history. Be concrete and brief.",
    `Author: ${input.author}`,
    `Message:\n${input.message}`,
    `The change (git show):\n${clip(input.show)}`,
  ].join("\n\n");
}

export const RESOLVE_TOOL = Object.freeze({
  name: "resolve_conflict",
  description: "Give the lines that should replace one merge conflict.",
  schema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: { type: "string" },
        description: "The resolved lines, without conflict markers, in order.",
      },
      reasoning: {
        type: "string",
        description: "One sentence on how the two sides were combined.",
      },
    },
    required: ["lines", "reasoning"],
    additionalProperties: false,
  },
});

/** @param {{ path: string, before: string[], ours: string[], base: string[], theirs: string[], after: string[], labels: { ours: string, theirs: string } }} input */
export function resolvePrompt(input) {
  const block = (/** @type {string[]} */ lines) => (lines.length ? lines.join("\n") : "(nothing)");
  return [
    `Resolve one merge conflict in ${input.path}. Keep what both sides meant where they can live together; when they cannot, prefer the clearer intent and say why.`,
    `Lines before the conflict:\n${clip(block(input.before), 3000)}`,
    `Ours (${input.labels.ours}):\n${clip(block(input.ours), 6000)}`,
    `Common ancestor:\n${clip(block(input.base), 6000)}`,
    `Theirs (${input.labels.theirs}):\n${clip(block(input.theirs), 6000)}`,
    `Lines after the conflict:\n${clip(block(input.after), 3000)}`,
  ].join("\n\n");
}

export const BRANCH_TOOL = Object.freeze({
  name: "describe_branch",
  description: "Describe a branch's changes as a pull request.",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", maxLength: 80, description: "The pull request's title." },
      body: {
        type: "string",
        description:
          "Markdown: a summary paragraph, then a list of the changes, then how to test them.",
      },
    },
    required: ["title", "body"],
    additionalProperties: false,
  },
});

export function branchPrompt(
  /** @type {{ branch: string, base: string, log: string, stat: string, diff: string }} */ input,
) {
  return [
    `Describe the branch ${input.branch} as a pull request into ${input.base}.`,
    `Commits:\n${clip(input.log, 6000)}`,
    `Files:\n${clip(input.stat, 4000)}`,
    `Diff:\n${clip(input.diff, 14_000)}`,
  ].join("\n\n");
}

/** The argument as a string, or "" when the brain left it out or gave something else. */
export const text = (/** @type {unknown} */ value) =>
  typeof value === "string" ? value.trim() : "";
