// What the plugin keeps about agents (PG-91, ADR 0346), made once per plugin in database.js, which
// watches every command with it (gate.js) before any is answered: their access per connection
// (access.js), their audit list (log.js), how their SQL runs (run.js), and who hears a list change
// (the audit panel). The feature (index.js) finds it by the plugin's bridge. No DOM.

import { createAccess } from "./access.js";
import { createGate } from "./gate.js";
import { createLog } from "./log.js";
import { createAgentRuns, limitsOf } from "./run.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {Pick<import("../../feature-host.js").Deps, "manager" | "execute" | "settings" | "confirm" | "cancelled">} Deps
 */

/** The plugin's id: its own calls are neither checked nor listed. */
export const OWN = "endue.database";

/** @type {WeakMap<object, ReturnType<typeof createAgents>>} */
const byBridge = new WeakMap();

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call" | "onEvent">} bridge
 * @param {() => Deps} deps The plugin's, asked for only once a command runs.
 */
export function createAgents(bridge, deps) {
  /** @type {Set<(connection: string) => void>} */
  const listeners = new Set();
  const access = createAccess(bridge);
  const log = createLog(bridge);
  const gate = createGate({
    bridge,
    own: OWN,
    find: (ref) => deps().manager.get(ref),
    access,
    log,
    changed: (connection) => {
      for (const listener of listeners) listener(connection);
    },
  });
  /** @type {ReturnType<typeof createAgentRuns> | undefined} */
  let made;
  const runs = () => {
    if (!made) {
      const d = deps();
      const { execute, confirm, cancelled } = d;
      made = createAgentRuns({
        execute,
        confirm,
        cancelled,
        settings: () => d.settings(),
        access,
        gate,
      });
    }
    return made;
  };
  const agents = {
    access,
    log,
    gate,
    /** How agents' SQL runs. */
    get runs() {
      return runs();
    },
    /** The row limit and timeout an agent's ask comes to, under the settings. */
    limits: (/** @type {import("./run.js").Limits} */ asked, rows = 100) =>
      limitsOf(deps().settings(), asked, rows),
    /** Hear a connection's list change; the function it returns stops it. */
    onChange: (/** @type {(connection: string) => void} */ listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** The connections agents may see. */
    visible: async (/** @type {Connection[]} */ list) => {
      const closed = await Promise.all(list.map(async (c) => (await access.of(c.id)).closed));
      return list.filter((_, i) => !closed[i]);
    },
    /** An agent's query: masked, limited, a write asked first. */
    query: (
      /** @type {Connection} */ conn,
      /** @type {string} */ sql,
      /** @type {Record<string, unknown>} */ args,
    ) =>
      runs().run(conn, sql, {
        args,
        command: "endue.database.query",
        limits: { maxRows: args.maxRows, timeoutSeconds: args.timeoutSeconds },
      }),
  };
  byBridge.set(bridge, agents);
  return agents;
}

/** The plugin's agents, by its bridge (none in a test that builds a feature alone). */
export const agentsOf = (/** @type {object} */ bridge) => byBridge.get(bridge);
