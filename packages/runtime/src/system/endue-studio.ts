/**
 * An endue agent's Studio inside the desk: the Agents plugin (`endue.agents`) on one agent, at the
 * facet a board row or button names. The agent window and its Studio board never send the person
 * to endue.ai; what the board only reads, the Agents Studio changes.
 */
import type { ShellCtx } from "../shell/context";

/** The Agents plugin, and its commands that open New agent and one agent's Studio. */
export const AGENTS = "endue.agents";
export const NEW_AGENT = "endue.agents.new";
export const AGENT_STUDIO = "endue.agents.studio";
/** How often, and how far apart, the Agents plugin is asked while it is still starting. */
const TRIES = 20;
const APART_MS = 150;

/** The Agents Studio's facets for an endue agent. */
export type StudioFacet =
  | "identity"
  | "prompt"
  | "traits"
  | "skills"
  | "connectors"
  | "channels"
  | "status"
  | "settings";

/** Each part of the board, and the facet of the Agents Studio where it is changed. */
const FACETS: Record<string, StudioFacet> = {
  character: "identity",
  profile: "identity",
  wallpaper: "identity",
  prompt: "prompt",
  memory: "prompt",
  trait: "traits",
  skills: "skills",
  tools: "skills",
  connectors: "connectors",
  mcp: "connectors",
  devices: "connectors",
  channel: "channels",
  canvas: "channels",
  live: "channels",
  api: "channels",
  model: "settings",
  relations: "settings",
  settings: "settings",
  analytics: "status",
  artifacts: "status",
  workspaces: "status",
};

/** The facet a board section opens; the agent's identity for one it does not know. */
export const studioFacet = (section?: string): StudioFacet =>
  (section && FACETS[section]) || "identity";

const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Open the Agents plugin's window, then run one of its own commands, asked again while the plugin
 * is still registering it. Rejects when the desk has no Agents.
 */
export async function runInAgents(ctx: ShellCtx, command: string, args?: unknown): Promise<void> {
  const commands = ctx.runtime?.commands;
  if (!commands) throw new Error("no Agents here");
  await commands.run("desk.plugins.open", { plugin: AGENTS });
  for (let tried = 1; ; tried++) {
    try {
      await commands.run(command, args);
      return;
    } catch (error) {
      if (tried >= TRIES) throw error;
      await later(APART_MS);
    }
  }
}

/** Open an endue agent's Studio in the Agents plugin, at the facet `section` names. */
export function openAgentStudio(ctx: ShellCtx, agentId: string, section?: string): Promise<void> {
  return runInAgents(ctx, AGENT_STUDIO, { agent: agentId, facet: studioFacet(section) });
}
