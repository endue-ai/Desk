// Asking the desk's brain (PG-90): brain.ask under brain:ask (ADR 0059), one question in a session
// of its own that never reads or writes the person's conversation with Eris, the answer the
// arguments of the task's tool, checked here before use. A desk without a brain answers
// `unsupported`; that, a refused grant, an answer in words and a brain that does not answer in
// time each come back as a sentence, and the console works as before.

import { TOOL_NAMES } from "./payload.js";

/**
 * @typedef {import("./payload.js").Task} Task
 * @typedef {{ call(method: string, params?: any): Promise<any>,
 *   onEvent?(listener: (event: { event: string, data: any }) => void): () => void }} Bridge
 * @typedef {{ ok: true, value: Record<string, unknown> } | { ok: false, text: string }} Asked
 */

export const SCOPE = Object.freeze({ permission: "brain:ask" });
const WAIT_MS = 120_000;
export const NO_BRAIN =
  "No brain is set up on this desk, so Eris cannot help with SQL here; the console works as before.";

const STATEMENT = {
  type: "string",
  maxLength: 20_000,
  description: "The SQL, as it goes in the console: a statement, or a short script.",
};
const EXPLANATION = {
  type: "string",
  maxLength: 4000,
  description: "Plain sentences for the person; no SQL in them.",
};

/** The tool of each task: the brain must call it, and its arguments are the answer. */
export const TOOLS = Object.freeze({
  write: {
    name: TOOL_NAMES.write,
    description: "Propose SQL for the person's request; they review it before anything runs.",
    schema: {
      type: "object",
      properties: { statement: STATEMENT, explanation: EXPLANATION },
      required: ["statement", "explanation"],
      additionalProperties: false,
    },
  },
  fix: {
    name: TOOL_NAMES.fix,
    description: "Propose the failed statement fixed; the person reviews it before it runs.",
    schema: {
      type: "object",
      properties: { statement: STATEMENT, explanation: EXPLANATION },
      required: ["statement", "explanation"],
      additionalProperties: false,
    },
  },
  explain: {
    name: TOOL_NAMES.explain,
    description: "Explain a SQL statement to the person about to run it.",
    schema: {
      type: "object",
      properties: { explanation: EXPLANATION },
      required: ["explanation"],
      additionalProperties: false,
    },
  },
  plan: {
    name: TOOL_NAMES.plan,
    description: "Explain a query plan, with an index or a rewrite as a suggestion when one helps.",
    schema: {
      type: "object",
      properties: { explanation: EXPLANATION, suggestion: STATEMENT },
      required: ["explanation"],
      additionalProperties: false,
    },
  },
});

/** @param {Bridge} bridge */
export function createBrain(bridge) {
  /** @type {Map<string, (data: any) => void>} */
  const waiting = new Map();
  /** Turns that ended before their id came back. @type {Map<string, any>} */
  const early = new Map();
  let asked = false;
  bridge.onEvent?.((event) => {
    if (event.event !== "brain.turn") return;
    const data = event.data;
    if (!["completed", "error", "offline"].includes(data?.kind)) return;
    const settle = waiting.get(data.turnId);
    if (settle) settle(data);
    else early.set(data.turnId, data);
  });

  /** Start the ask; asks for the grant once when it is missing (a community install). */
  const start = async (/** @type {Record<string, unknown>} */ params) => {
    try {
      return await bridge.call("brain.ask", params);
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code !== "permission_denied" || asked) throw error;
      asked = true;
      const answer = await bridge.call("perm.request", {
        permission: { ...SCOPE },
        reason: "Eris helps with the SQL in a console: what is sent is shown first.",
      });
      if (!answer?.granted) throw error;
      return bridge.call("brain.ask", params);
    }
  };

  /**
   * Ask once; the tool's arguments, or the sentence that says why there are none.
   * @param {string} prompt @param {Task} task
   * @returns {Promise<Asked>}
   */
  async function ask(prompt, task) {
    /** @type {string} */
    let turnId;
    try {
      ({ turnId } = await start({ prompt, tool: TOOLS[task], scope: { ...SCOPE } }));
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error)?.code;
      if (code === "permission_denied")
        return { ok: false, text: "The desk does not let the Database plugin ask Eris." };
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, text: code === "unsupported" ? NO_BRAIN : `${NO_BRAIN} (${message})` };
    }
    const data = await new Promise((resolve) => {
      const finish = (/** @type {any} */ d) => {
        clearTimeout(timer);
        waiting.delete(turnId);
        resolve(d);
      };
      const timer = setTimeout(() => finish(null), WAIT_MS);
      waiting.set(turnId, finish);
      const kept = early.get(turnId);
      if (kept) {
        early.delete(turnId);
        finish(kept);
      }
    });
    const d = /** @type {any} */ (data);
    if (!d) return { ok: false, text: "Eris did not answer in time: nothing changed." };
    if (d.kind !== "completed")
      return { ok: false, text: `Eris could not answer: ${d.text || "the brain is offline"}.` };
    if (!d.structured || typeof d.structured !== "object")
      return { ok: false, text: "Eris answered in words only, so there is nothing to propose." };
    return { ok: true, value: d.structured };
  }
  return { ask };
}
