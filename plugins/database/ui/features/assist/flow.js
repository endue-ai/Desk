// One ask of Eris from the console on screen (PG-90, ADR 0345): what it is about (context.js), the
// schema in scope (scope.js), the facts and the prompt (payload.js); before a connection's first
// ask, what is sent is shown and goes only on Send; a connection closed to the brain sends
// nothing. The answer is checked, a proposed statement marked and planned by the server
// (check.js), and the person takes it, changed or as it is, or puts it aside in the proposal
// dialog. A taken proposal goes into the console; nothing is ever run here.

import { engineOf } from "../../engines/index.js";
import { checkWithServer, marksOf } from "./check.js";
import { contextOf, editOf, offerOf } from "./context.js";
import { factsOf, promptOf, sampleAllowed } from "./payload.js";
import { schemaFor } from "./scope.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("./payload.js").Task} Task
 * @typedef {import("./choices.js").Choice} Choice
 * @typedef {{
 *   mode: "first" | "read", connection: string, prompt: string, withSample: string,
 *   sampleWhy: string, sample: boolean, production: boolean, productionOn: boolean,
 * }} SentModel
 *   What the "what is sent" dialog shows: the prompt as it goes, and with a sample when one can be
 *   taken (`withSample`, else `sampleWhy` says why not); `production` when the connection is tagged
 *   so, whose samples go only with `productionOn`.
 * @typedef {{
 *   task: Task, title: string, connection: string, explanation: string, text: string,
 *   engine: Connection["engine"], readOnly: boolean, tag: Connection["tag"],
 *   write: boolean, marks: string[], server: import("./check.js").ServerCheck, sent: string,
 * }} ProposalModel
 */

const TITLES = /** @type {Record<Task, string>} */ ({
  write: "Eris proposes a statement",
  explain: "Eris explains the statement",
  fix: "Eris proposes a fix",
  plan: "Eris explains the plan",
});

/**
 * @param {Deps} deps
 * @param {{ brain: ReturnType<typeof import("./brain.js").createBrain>, choices: ReturnType<typeof import("./choices.js").createChoices> }} parts
 */
export function createAssist(deps, { brain, choices }) {
  /** What each console sent last, by buffer id, for "what is sent" (this session). */
  /** @type {Map<string, { plain: string, withSample: string }>} */
  const last = new Map();

  /** The console on screen and its connection, or an Error that says what to do. */
  const consoleOf = () => {
    const shown = deps.consoles.current();
    if (shown?.kind !== "console")
      throw new Error("Open a console first: Eris helps with the SQL in a console.");
    const conn = deps.manager.get(shown.connection);
    if (!conn) throw new Error("This console has no connection: pick one first.");
    return { shown, conn };
  };

  /** The prompt of an ask, and with a sample when one can be taken. */
  const prompts = async (
    /** @type {Task} */ task,
    /** @type {Console} */ shown,
    /** @type {Connection} */ conn,
    /** @type {string} */ request,
  ) => {
    const { dialect } = engineOf(conn.engine);
    const ctx = contextOf(task, shown, deps.view.editor(), dialect);
    const schema = await schemaFor(deps, conn, `${request}\n${ctx.statement}`, dialect);
    const input = {
      task,
      conn,
      ...(request ? { request } : {}),
      ...(ctx.statement ? { statement: ctx.statement } : {}),
      ...(ctx.error ? { error: ctx.error } : {}),
      ...(ctx.plan ? { plan: ctx.plan } : {}),
      schema,
    };
    const plain = promptOf(task, factsOf(input));
    const withSample = ctx.sample ? promptOf(task, factsOf({ ...input, sample: ctx.sample })) : "";
    return { ctx, plain, withSample };
  };

  /** The "what is sent" dialog's model. */
  const sentModel = (
    /** @type {SentModel["mode"]} */ mode,
    /** @type {Connection} */ conn,
    /** @type {Choice} */ choice,
    /** @type {{ plain: string, withSample: string }} */ p,
  ) =>
    /** @type {SentModel} */ ({
      mode,
      connection: conn.name,
      prompt: p.plain,
      withSample: p.withSample,
      sampleWhy: p.withSample ? "" : "The console has no rows from a last run to take a sample of.",
      sample: choice.sample,
      production: conn.tag === "production",
      productionOn: choice.production,
    });

  /** Keep what the dialog answered; the sample goes only where the connection allows one. */
  const keep = async (
    /** @type {Connection} */ conn,
    /** @type {unknown} */ answer,
    /** @type {boolean} */ shown,
  ) => {
    const a = /** @type {{ sample?: unknown, production?: unknown }} */ (answer);
    const change = {
      shown,
      sample: a.sample === true,
      ...(conn.tag === "production" ? { production: a.production === true } : {}),
    };
    await choices.set(conn.id, change);
    return choices.of(conn.id);
  };

  /**
   * Ask Eris; resolves with what the status line says.
   * @param {Task} task
   * @param {{ sentence?: string }} [args]
   */
  async function ask(task, args = {}) {
    const { shown, conn } = consoleOf();
    let choice = await choices.of(conn.id);
    if (choice.closed)
      throw new Error(
        `${conn.name} is closed to Eris: nothing is sent from it (Database: open this connection to Eris).`,
      );
    let request = "";
    if (task === "write") {
      request =
        args.sentence ??
        (await deps.pick(
          "Eris: what should the statement do?",
          [],
          true,
          "a sentence, in your words",
        )) ??
        "";
      if (!request.trim()) throw deps.cancelled("Nothing was asked.");
    }
    const editor = deps.view.editor();
    const p = await prompts(task, shown, conn, request);
    if (!choice.shown) {
      const answer = await deps.dialog("assist-sent", sentModel("first", conn, choice, p));
      if (!answer) throw deps.cancelled("Nothing was sent to Eris.");
      choice = await keep(conn, answer, true);
    }
    const sample = choice.sample && p.withSample && sampleAllowed(conn, choice).ok;
    const prompt = sample ? p.withSample : p.plain;
    last.set(shown.id, { plain: p.plain, withSample: p.withSample });
    deps.say("Asking Eris…");
    const asked = await brain.ask(prompt, task);
    if (!asked.ok) throw new Error(asked.text);
    const answer =
      /** @type {{ statement?: unknown, explanation?: unknown, suggestion?: unknown }} */ (
        asked.value
      );
    const text = (/** @type {unknown} */ v) => (typeof v === "string" ? v : "");
    const checked = {
      statement: text(answer.statement),
      explanation: text(answer.explanation),
      suggestion: text(answer.suggestion),
    };
    const offered = offerOf(task, checked);
    if (!offered.trim()) throw new Error("Eris gave nothing to propose: the console is as it was.");
    const proposes = task === "write" || task === "fix";
    const server = proposes
      ? await checkWithServer(deps, conn, offered)
      : checked.suggestion
        ? await checkWithServer(deps, conn, checked.suggestion)
        : { state: /** @type {const} */ ("unchecked"), text: "An explanation: nothing to check." };
    const marks = marksOf(conn, offered);
    /** @type {ProposalModel} */
    const model = {
      task,
      title: TITLES[task],
      connection: conn.name,
      explanation: proposes ? checked.explanation : "",
      text: offered,
      engine: conn.engine,
      readOnly: conn.readOnly,
      tag: conn.tag,
      write: marks.write,
      marks: marks.marks,
      server,
      sent: prompt,
    };
    deps.say("");
    const taken = /** @type {{ text?: unknown } | undefined} */ (
      await deps.dialog("assist-proposal", model)
    );
    if (!taken || typeof taken.text !== "string") {
      deps.say("Eris's proposal is put aside: the console is as it was.");
      return "put aside";
    }
    if (deps.consoles.current()?.id !== shown.id || deps.view.editor().text !== editor.text)
      throw new Error("The console changed while Eris answered: ask again.");
    const edit = editOf(p.ctx, editor.text, taken.text);
    deps.view.replace(edit.from, edit.to, edit.text);
    deps.view.select(edit.from, edit.from + edit.text.length);
    const said = "Eris's proposal is in the console; nothing ran.";
    deps.say(said);
    return said;
  }

  return {
    ask,
    /** Show what this console sends (its last prompt, or what an explanation would send now). */
    async sent() {
      const { shown, conn } = consoleOf();
      const choice = await choices.of(conn.id);
      const text = deps.view.editor().text;
      const p = text.trim()
        ? await prompts("explain", shown, conn, "")
        : await prompts("write", shown, conn, "(the sentence you type)");
      const kept = last.get(shown.id);
      const answer = await deps.dialog("assist-sent", sentModel("read", conn, choice, kept ?? p));
      if (answer) await keep(conn, answer, true);
      return (kept ?? p).plain;
    },
    /** Close a connection to the brain, or open it again. */
    async closed(/** @type {boolean} */ closed) {
      const { conn } = consoleOf();
      await choices.set(conn.id, { closed });
      const said = closed
        ? `${conn.name} is closed to Eris: nothing is sent from it.`
        : `${conn.name} is open to Eris again: what is sent is shown in Database: what this console sends to Eris.`;
      deps.say(said);
      return said;
    },
  };
}
