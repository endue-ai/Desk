// Who calls the plugin's commands, and what agents may not (PG-91, ADR 0346). The core's cmd.invoked
// says the caller (`desk` is the person; agent:<id> an agent of the brain; another plugin, such as
// the assistant, by its id); the SDK hands the handler the same arguments object, so the call is
// found by it a turn later (else by the order invocations came in). A request the desk sends by name
// has no cmd.invoked: it is the person's.
// An agent's call naming a connection closed to agents is refused, so is one naming none while any
// is closed (the command would take the one on screen), and only the person changes agents' access
// or clears their list. Every call of an agent tool by anyone but the plugin itself, and every other
// command's call by an agent, goes on the connection's audit list with how it ended. No DOM.

import { databaseOf } from "../../databases.js";

/**
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./log.js").Entry} Entry
 * @typedef {Omit<Entry, "at" | "caller" | "command" | "outcome"> & { connection: string, outcome?: Entry["outcome"] }} Note
 * @typedef {{ caller: string, command: string, at: number, notes: Note[] }} Call
 */

export const PERSON = "desk";
const HEARD_MAX = 64;
/** The agents' tools: every call is recorded, whoever makes it. */
export const TOOLS = new Set(
  [
    "connections",
    "schema",
    "query",
    "explain-statement",
    "object-ddl",
    "sample-rows",
    "table-stats",
    "sessions-list",
    "check-statement",
  ].map((id) => `endue.database.${id}`),
);
/** What only the person may call: what agents may reach, and their list. */
export const PERSON_ONLY = new Set([
  "endue.database.agent-access",
  "endue.database.agent-audit-clear",
]);
/**
 * The person's own runs: the console's SQL, pending edits, the forms' scripts, a copy, and what
 * they keep for a connection. They run with the person's session, unmasked and writable, so an
 * agent or an MCP server never runs them; agents read through the tools above, read-only and
 * masked (ADR 0346, ADR 0367).
 */
export const PERSON_RUNS = new Set(
  [
    "run",
    "run-all",
    "run-file",
    "run-transaction",
    "run-again-and-compare",
    "dry-run",
    "commit",
    "submit-changes",
    "table-design-run",
    "table-design-dry-run",
    "schema-compare-run",
    "schema-compare-dry-run",
    "maintenance-run",
    "routine-run",
    "transfer-start",
    "transfer-query",
    "forget-password",
    "forget-ssh-host-key",
  ].map((id) => `endue.database.${id}`),
);
/** An agent of the brain or an MCP server, as cmd.invoked names them. */
const outsideCaller = (/** @type {string} */ caller) =>
  caller.startsWith("agent:") || caller.startsWith("mcp:");

/** A refusal of the gate's: the call never reached its command. */
export class AgentRefusal extends Error {
  constructor(/** @type {string} */ message) {
    super(message);
    this.name = "AgentRefusal";
  }
}

/**
 * @param {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "onEvent">,
 *   own: string,
 *   find(ref: string): Connection | undefined,
 *   access: ReturnType<typeof import("./access.js").createAccess>,
 *   log: ReturnType<typeof import("./log.js").createLog>,
 *   changed(connection: string): void,
 *   now?(): number,
 * }} deps
 */
export function createGate(deps) {
  const now = deps.now ?? (() => Date.now());
  /** @type {WeakMap<object, Call>} */
  const calls = new WeakMap();
  /** The invocations heard and not yet taken by their handler, oldest first, by command. */
  /** @type {Map<string, Array<{ caller: string, args: unknown }>>} */
  const heard = new Map();
  deps.bridge.onEvent?.((event) => {
    if (event.event !== "cmd.invoked") return;
    const { id, caller, args } = event.data;
    const list = heard.get(id) ?? [];
    list.push({ caller, args });
    if (list.length > HEARD_MAX) list.shift();
    heard.set(id, list);
  });

  /**
   * The call these arguments came with: the invocation heard with this very object, else the oldest
   * one of the command not taken yet (arguments the SDK made afresh), else the person's request.
   */
  const callOf = (/** @type {string} */ command, /** @type {object} */ args) => {
    let call = calls.get(args);
    if (!call) {
      const list = heard.get(command) ?? [];
      const at = list.findIndex((h) => h.args === args);
      const [taken] = list.splice(Math.max(at, 0), 1);
      call = { caller: taken?.caller ?? PERSON, command, at: now(), notes: [] };
      calls.set(args, call);
    }
    return call;
  };

  const isAgent = (/** @type {Call} */ call) => call.caller !== PERSON && call.caller !== deps.own;
  const recorded = (/** @type {Call} */ call) =>
    call.caller !== deps.own && (TOOLS.has(call.command) || call.caller !== PERSON);

  /** Refuse what an agent may not do before its command starts. */
  const check = async (/** @type {Call} */ call, /** @type {Record<string, unknown>} */ args) => {
    if (PERSON_ONLY.has(call.command) && isAgent(call))
      throw new AgentRefusal("Only the person changes what agents may reach.");
    if (PERSON_RUNS.has(call.command) && outsideCaller(call.caller))
      throw new AgentRefusal(
        "Only the person runs this: agents read with endue.database.query, read-only and masked.",
      );
    if (!isAgent(call)) return;
    const ref = args.connection;
    if (typeof ref === "string") {
      const conn = deps.find(ref);
      if (conn && (await deps.access.of(conn.id)).closed)
        throw new AgentRefusal(`${conn.name} is closed to agents.`);
    } else if (call.command !== "endue.database.connections" && (await deps.access.anyClosed()))
      throw new AgentRefusal(
        "Name the connection: some connections are closed to agents, and this command would take the one on screen.",
      );
  };

  /** The entries a finished call leaves, by connection. */
  const settle = async (
    /** @type {Call} */ call,
    /** @type {Record<string, unknown>} */ args,
    /** @type {unknown} */ error,
  ) => {
    if (!recorded(call)) return;
    const message = error instanceof Error ? error.message : error ? String(error) : "";
    const code = /** @type {{ code?: string }} */ (error)?.code;
    /** @type {Entry["outcome"]} */
    const ending =
      error instanceof AgentRefusal || /** @type {Error} */ (error)?.name === "Refusal"
        ? "refused"
        : code === "cancelled"
          ? "cancelled"
          : error
            ? "failed"
            : "ran";
    let notes = call.notes;
    if (notes.length === 0) {
      const ref = typeof args.connection === "string" ? args.connection : "";
      const conn = ref ? deps.find(ref) : undefined;
      if (!conn) return;
      const { connection: _, ...rest } = args;
      const shown = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
      const database = typeof args.database === "string" ? { database: args.database } : {};
      notes = [
        {
          connection: conn.id,
          statement: `${call.command}${shown}`,
          rows: null,
          asked: false,
          allowed: null,
          ...database,
        },
      ];
    }
    /** @type {Map<string, Entry[]>} */
    const by = new Map();
    for (const { connection, outcome, ...note } of notes) {
      const declined = note.asked && note.allowed === false;
      const db = databaseOf(connection);
      /** @type {Entry} */
      const entry = {
        ...note,
        ...(db && !note.database ? { database: db } : {}),
        at: new Date(call.at).toISOString(),
        caller: call.caller,
        command: call.command,
        outcome: outcome ?? (declined ? "declined" : ending),
        ...(message && !outcome ? { error: message } : {}),
      };
      by.set(connection, [...(by.get(connection) ?? []), entry]);
    }
    await Promise.all(
      [...by].map(async ([connection, entries]) => {
        await deps.log.add(connection, entries);
        deps.changed(connection);
      }),
    );
  };

  /**
   * The commands, each call checked first and recorded after.
   * @template {{ on(name: string, handler: (args: unknown) => unknown): unknown }} C
   * @param {C} commands
   * @returns {C}
   */
  const watch = (commands) => ({
    ...commands,
    on: (/** @type {string} */ name, /** @type {(args: unknown) => unknown} */ handler) =>
      commands.on(name, async (/** @type {unknown} */ given) => {
        const args = /** @type {Record<string, unknown>} */ (
          given && typeof given === "object" ? given : {}
        );
        // cmd.invoked reaches the event listeners in the same turn, after the handler starts.
        await Promise.resolve();
        const call = callOf(name, args);
        try {
          await check(call, args);
          const result = await handler(args);
          await settle(call, args, undefined);
          return result;
        } catch (error) {
          await settle(call, args, error);
          throw error;
        }
      }),
  });

  return {
    watch,
    /** The call these arguments came with (the handler's own object). */
    callOf: (/** @type {string} */ command, /** @type {object} */ args) => callOf(command, args),
    isAgent,
    /** Keep what a call ran on a connection, for its entry. */
    note: (/** @type {object} */ args, /** @type {string} */ command, /** @type {Note} */ note) =>
      void callOf(command, args).notes.push(note),
  };
}
