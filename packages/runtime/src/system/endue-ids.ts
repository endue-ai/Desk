/**
 * What the shell keeps of the person's endue AI agents and spaces (ADR 0129), without the shell:
 * the state, its views' names and endue.ai's own pages for each. The views are `endue-agent:<id>`
 * and `endue-space:<id>`; pages are built only on endue.ai's origin, from ids encoded as one path
 * segment.
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioConversation,
  StudioSpace,
  StudioSpacesGetResult,
} from "@endue-ai/bridge";

export const ENDUE_AGENT_VIEW = "endue-agent:";
export const ENDUE_SPACE_VIEW = "endue-space:";

/** A read of one agent's facets or one space's detail. */
export type Read<T> =
  | { state: "loading" }
  | { state: "ready"; value: T }
  | { state: "failed"; why: string; signedOut: boolean };

export interface EndueState {
  /**
   * off: not signed in, or a host without studio.*, so the agent bar keeps the agent directory;
   * loading, ready, or offline when endue AI could not be read.
   */
  state: "off" | "loading" | "ready" | "offline";
  agents: StudioAgent[];
  /** The most recently active conversations: who works, and who waits for the person. */
  conversations: StudioConversation[];
  spaces: StudioSpace[];
  facets: Record<string, Read<StudioAgentsFacetsResult>>;
  details: Record<string, Read<StudioSpacesGetResult>>;
  /** The agent and the space last chosen in the agent bar. */
  agent: string | null;
  space: string | null;
  /** The windows that show their back (Studio), by view; never kept across a relaunch. */
  flipped: string[];
}

export function emptyEndue(): EndueState {
  return {
    state: "off",
    agents: [],
    conversations: [],
    spaces: [],
    facets: {},
    details: {},
    agent: null,
    space: null,
    flipped: [],
  };
}

export type EnduePresence = "working" | "waiting" | "online" | "paused" | "offline";

/**
 * An agent's presence as the agent cards say it (ADR 0112): a disabled one is paused, an archived
 * one offline; an active one works while a conversation of it runs, waits while one waits for the
 * person, and is online otherwise.
 */
export function enduePresence(
  agent: Pick<StudioAgent, "id" | "status">,
  conversations: readonly Pick<StudioConversation, "agentId" | "activity">[],
): EnduePresence {
  if (agent.status === "inactive") return "paused";
  if (agent.status !== "active") return "offline";
  const own = conversations.filter((c) => c.agentId === agent.id);
  if (own.some((c) => c.activity === "active")) return "working";
  if (own.some((c) => c.activity === "waiting")) return "waiting";
  return "online";
}

/** endue.ai, the only origin the shell opens pages on. */
export const WEB = "https://endue.ai";
export const agentPage = (id: string) => `${WEB}/agent/${encodeURIComponent(id)}/studio`;
export const spacePage = (id: string) => `${WEB}/spaces/${encodeURIComponent(id)}`;

/** A colour that may go into a style: #rrggbb only. */
export const hexColour = (colour: string | undefined) =>
  colour && /^#[0-9a-f]{6}$/i.test(colour) ? colour : undefined;
