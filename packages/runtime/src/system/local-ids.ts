/**
 * The names of the agent programs on this computer, with nothing to import, so titles, views and
 * the agent bar can name them without the shell's window code (ADR 0110).
 */
import type { LocalAgent, LocalAgentId } from "@endue-ai/bridge";

/** The view of a local agent's screen: `local:claude`. */
export const LOCAL_VIEW = "local:";

const BADGES: Record<LocalAgentId, string> = { claude: "CC", codex: "Cx" };
const NAMES: Record<LocalAgentId, string> = { claude: "Claude Code", codex: "Codex" };

export const isLocalAgent = (id: string): id is LocalAgentId => id === "claude" || id === "codex";

/** Two letters on the agent's avatar: Claude Code and Codex both start with a C. */
export const badgeOf = (id: LocalAgentId) => BADGES[id];

export function localName(agents: readonly LocalAgent[], id: string): string {
  return agents.find((a) => a.id === id)?.name ?? (isLocalAgent(id) ? NAMES[id] : id);
}
