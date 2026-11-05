// The commands registered again with what the manifest cannot say of them: each one's description
// and args schema (schemas.js), and which agents get as tools (ADR 0088): what reads the engine,
// and what acts on it, the irreversible ones waiting for the person's approval (ADR 0078).
import { COMMANDS } from "./schemas.js";

/** What agents may read through the plugin (ADR 0088): each answers data and changes nothing. */
export const READS = new Set(
  [
    "containers",
    "compose",
    "images",
    "volumes",
    "networks",
    "system",
    "tail",
    "inspect",
    "stats",
  ].map((name) => `endue.docker.${name}`),
);

/** What agents may do with the engine; the irreversible ones wait for the person (ADR 0078). */
export const ACTS = new Set(
  [
    ...["start", "stop", "restart", "pause", "unpause", "kill", "remove", "run", "pull"],
    ...["remove-image", "prune-images", "remove-volume", "prune-volumes", "remove-network"],
    ...["prune-networks", "up", "down", "compose-start", "compose-stop", "compose-restart"],
    ...["compose-pull", "prune"],
  ].map((name) => `endue.docker.${name}`),
);

/**
 * Register every command again with its description and schema, and those agents get as tools
 * marked so (`agent`, `readOnly`). The manifest already declares them, so this updates the
 * plugin's own entries; a desk that refuses keeps the manifest's.
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
        argsSchema: args ?? { type: "object", properties: {}, additionalProperties: false },
        ...(READS.has(id) || ACTS.has(id) ? { agent: true } : {}),
        ...(READS.has(id) ? { readOnly: true } : {}),
      })
      .catch(() => {});
  }
}
