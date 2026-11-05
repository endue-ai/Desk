// Every command the plugin provides, with what an agent needs to call it: a description and a JSON
// Schema for its args. The ids, titles and keywords are the manifest's (a test keeps them equal);
// registering them again with cmd.register adds the description and schema.

import { VIEWS } from "./agents.js";
import { COLUMNS } from "./board.js";
import { AGENT_IDS } from "./catalog.js";

/** @typedef {{ id: string, title: string, keywords?: string[], description: string, args?: object }} CommandSpec */

const AGENT = { enum: [...AGENT_IDS], description: "An agent's id" };
const PROMPT = { type: "string", minLength: 1, description: "What to ask, as text" };
const MODEL = { type: "string", description: "A model name the program knows; empty: its default" };
const CARD = { type: "string", description: "A card's id; the selected card when absent" };
const object = (
  /** @type {Record<string, object>} */ properties,
  /** @type {string[]} */ required = [],
) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/** @type {CommandSpec[]} */
export const COMMANDS = [
  {
    id: "endue.local-agents.open",
    title: "Local agents: open",
    keywords: ["claude", "codex", "gemini", "grok", "ai"],
    description: "Show the Local agents surface, on a view when view names one.",
    args: object({ view: { enum: [...VIEWS] } }),
  },
  {
    id: "endue.local-agents.detect",
    title: "Local agents: look for agent programs",
    keywords: ["detect", "scan", "installed"],
    description:
      "Ask every known agent program (claude, codex, gemini, grok, qwen, copilot, cursor-agent, opencode) for its version, and return which are installed.",
  },
  {
    id: "endue.local-agents.list",
    title: "Local agents: list the agents",
    keywords: ["installed", "versions"],
    description:
      "Return every known agent with its state (ready, missing, broken), version and how it is kept read-only.",
  },
  {
    id: "endue.local-agents.ask",
    title: "Local agents: ask an agent",
    keywords: ["query", "question", "prompt"],
    description:
      "Ask one agent one question with no conversation and return its answer. Asks for the prompt when absent; the chat's agent when agent is absent.",
    args: object({ prompt: PROMPT, agent: AGENT, model: MODEL }),
  },
  {
    id: "endue.local-agents.chat",
    title: "Local agents: chat",
    keywords: ["conversation", "talk", "message"],
    description:
      "Show the chat with an agent; with prompt, send it in the conversation and return the answer.",
    args: object({ agent: AGENT, prompt: PROMPT }),
  },
  {
    id: "endue.local-agents.new-chat",
    title: "Local agents: new conversation",
    keywords: ["clear", "reset", "start over"],
    description: "Start the agent's conversation over: no messages, no session.",
    args: object({ agent: AGENT }),
  },
  {
    id: "endue.local-agents.use",
    title: "Local agents: talk to another agent",
    keywords: ["switch", "pick", "agent"],
    description: "Make agent the chat's agent. Asks which when absent.",
    args: object({ agent: AGENT }),
  },
  {
    id: "endue.local-agents.model",
    title: "Local agents: set the conversation's model",
    keywords: ["model", "opus", "gpt", "flash"],
    description: "The model the agent's conversation asks for. Asks when model is absent.",
    args: object({ model: MODEL, agent: AGENT }),
  },
  {
    id: "endue.local-agents.compare",
    title: "Local agents: compare answers",
    keywords: ["side by side", "all", "fan out"],
    description:
      "Ask several agents the same question at once, show the answers side by side and return them. Asks for the prompt when absent; the last agents compared when agents is absent.",
    args: object({ prompt: PROMPT, agents: { type: "array", items: AGENT, minItems: 1 } }),
  },
  {
    id: "endue.local-agents.board",
    title: "Local agents: board",
    keywords: ["kanban", "tasks", "cards"],
    description: "Show the board and return its cards with their columns.",
  },
  {
    id: "endue.local-agents.add-card",
    title: "Local agents: add a card",
    keywords: ["task", "new", "kanban"],
    description:
      "Add a card to To do: a prompt for one agent. With run, it goes to Running at once. Asks for the prompt when absent.",
    args: object({
      prompt: PROMPT,
      title: { type: "string" },
      agent: AGENT,
      run: { type: "boolean" },
    }),
  },
  {
    id: "endue.local-agents.run-card",
    title: "Local agents: run the card",
    keywords: ["start", "task"],
    description:
      "Put a card in Running: its agent answers it when there is room, and the card moves to Done or Failed.",
    args: object({ card: CARD }),
  },
  {
    id: "endue.local-agents.move-card",
    title: "Local agents: move the card",
    keywords: ["column", "kanban"],
    description: "Put a card in a column. Into running runs it; out of running stops it.",
    args: object({ card: CARD, column: { enum: [...COLUMNS] } }, ["column"]),
  },
  {
    id: "endue.local-agents.remove-card",
    title: "Local agents: remove the card",
    keywords: ["delete", "task"],
    description: "Remove a card, stopping it when it runs.",
    args: object({ card: CARD }),
  },
  {
    id: "endue.local-agents.clear-done",
    title: "Local agents: clear Done",
    keywords: ["archive", "clean"],
    description: "Remove every card in Done and return how many went.",
  },
  {
    id: "endue.local-agents.activity",
    title: "Local agents: activity",
    keywords: ["runs", "history", "log"],
    description: "Show and return this session's runs, newest first: agent, prompt, state, answer.",
  },
  {
    id: "endue.local-agents.stop",
    title: "Local agents: stop",
    keywords: ["cancel", "abort", "kill"],
    description:
      "Stop a run by id, or every run in progress when run is absent. Returns how many stopped.",
    args: object({ run: { type: "string" } }),
  },
];

/**
 * Register every command again with its description and schema. The manifest already declares
 * them, so this updates the plugin's own entries; a desk that refuses keeps the manifest's.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} bridge
 */
export function registerSchemas(bridge) {
  for (const { id, title, keywords, description, args } of COMMANDS) {
    void bridge
      .call("cmd.register", {
        id,
        title,
        description,
        ...(keywords ? { keywords } : {}),
        argsSchema: args ?? object({}),
      })
      .catch(() => {});
  }
}
