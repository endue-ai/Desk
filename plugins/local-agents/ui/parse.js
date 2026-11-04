// What an agent program prints, read line by line into events: the session it opened, the text it
// answers (whole blocks or deltas), the tools it used, what it cost and what went wrong. One reader
// per output format (catalog.js); a line a structured reader does not know is taken as text, so a
// program that changed its output still says something.

/**
 * @typedef {import("./catalog.js").Format} Format
 * @typedef {{ kind: "session", id: string }
 *   | { kind: "model", name: string }
 *   | { kind: "text", text: string, block?: boolean }
 *   | { kind: "final", text: string }
 *   | { kind: "tool", name: string, detail: string }
 *   | { kind: "usage", input?: number, output?: number, cost?: number }
 *   | { kind: "error", message: string, fatal: boolean }} AgentEvent
 * @typedef {{ line(line: string): AgentEvent[], end(): AgentEvent[] }} Reader
 */

/** A tool line's detail: the first input that says what it worked on, on one line. */
export function describe(/** @type {unknown} */ input) {
  if (typeof input === "string") return oneLine(input);
  if (Array.isArray(input)) return oneLine(input.filter((v) => typeof v === "string").join(" "));
  if (!input || typeof input !== "object") return "";
  const o = /** @type {Record<string, unknown>} */ (input);
  for (const key of ["command", "file_path", "path", "absolute_path", "pattern", "url", "query"]) {
    const value = o[key];
    if (typeof value === "string" && value) return oneLine(value);
    if (Array.isArray(value) && value.every((v) => typeof v === "string"))
      return oneLine(value.join(" "));
  }
  const text = o.description ?? o.prompt;
  return typeof text === "string" ? oneLine(text) : "";
}

const oneLine = (/** @type {string} */ text) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
};

/** Escape sequences and control characters out, newlines and tabs kept. */
export function plainText(/** @type {string} */ text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 27) {
      const next = text[i + 1];
      if (next === "[") {
        i += 2;
        while (i < text.length && !(text.charCodeAt(i) >= 0x40 && text.charCodeAt(i) <= 0x7e)) i++;
      } else if (next === "]") {
        i += 2;
        while (i < text.length && text.charCodeAt(i) !== 7 && text.charCodeAt(i) !== 27) i++;
        if (text.charCodeAt(i) === 27) i++;
      } else i++;
      continue;
    }
    if (code < 32 && code !== 10 && code !== 9) continue;
    out += text[i];
  }
  return out;
}

const json = (/** @type {string} */ line) => {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return undefined;
  try {
    const value = JSON.parse(trimmed);
    return value && typeof value === "object"
      ? /** @type {Record<string, any>} */ (value)
      : undefined;
  } catch {
    return undefined;
  }
};

const str = (/** @type {unknown} */ value) => (typeof value === "string" ? value : "");
const num = (/** @type {unknown} */ value) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** @returns {AgentEvent[]} */
const asText = (/** @type {string} */ line) => {
  const text = plainText(line);
  return text.trim() ? [{ kind: "text", text: `${text}\n` }] : [];
};

/**
 * Claude Code's (and Cursor Agent's) stream-json: system init, assistant messages of text and
 * tool_use blocks, Cursor's tool_call events, and one result with the cost.
 * @param {Record<string, any>} o
 * @returns {AgentEvent[]}
 */
function claudeEvent(o) {
  /** @type {AgentEvent[]} */
  const out = [];
  if (o.type === "system" && o.subtype === "init") {
    if (str(o.session_id)) out.push({ kind: "session", id: o.session_id });
    if (str(o.model)) out.push({ kind: "model", name: o.model });
  } else if (o.type === "assistant") {
    const content = o.message?.content;
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type === "text" && str(block.text))
        out.push({ kind: "text", text: block.text, block: true });
      else if (block?.type === "tool_use")
        out.push({ kind: "tool", name: str(block.name) || "tool", detail: describe(block.input) });
    }
  } else if (o.type === "tool_call" && o.subtype === "started" && o.tool_call) {
    const [key, call] = Object.entries(o.tool_call)[0] ?? [];
    const name = str(key).replace(/ToolCall$/, "") || "tool";
    out.push({ kind: "tool", name, detail: describe(call?.args) });
  } else if (o.type === "result") {
    if (str(o.session_id)) out.push({ kind: "session", id: o.session_id });
    out.push({
      kind: "usage",
      input: num(o.usage?.input_tokens),
      output: num(o.usage?.output_tokens),
      cost: num(o.total_cost_usd),
    });
    if (o.is_error === true || (str(o.subtype) && o.subtype !== "success"))
      out.push({
        kind: "error",
        message: str(o.result) || str(o.error) || `The run ended with ${o.subtype}.`,
        fatal: true,
      });
    else if (str(o.result)) out.push({ kind: "final", text: o.result });
  }
  return out;
}

/**
 * Codex's `exec --json`: thread and item events (0.44 and later), or the older `{ msg }` events.
 * @param {Record<string, any>} o
 * @returns {AgentEvent[]}
 */
function codexEvent(o) {
  if (o.msg && typeof o.msg === "object") return codexOld(o.msg);
  const item = o.item ?? {};
  switch (o.type) {
    case "thread.started":
      return str(o.thread_id) ? [{ kind: "session", id: o.thread_id }] : [];
    case "item.started":
      if (item.type === "command_execution")
        return [{ kind: "tool", name: "Run", detail: describe(item.command) }];
      if (item.type === "mcp_tool_call")
        return [{ kind: "tool", name: `${str(item.server)}.${str(item.tool)}`, detail: "" }];
      if (item.type === "web_search")
        return [{ kind: "tool", name: "Search", detail: describe(item.query) }];
      return [];
    case "item.completed":
      if (item.type === "agent_message" && str(item.text))
        return [{ kind: "text", text: item.text, block: true }];
      if (item.type === "file_change") {
        const paths = (Array.isArray(item.changes) ? item.changes : []).map((c) => str(c?.path));
        return [{ kind: "tool", name: "Edit", detail: describe(paths.filter(Boolean)) }];
      }
      if (item.type === "error" && str(item.message))
        return [{ kind: "error", message: item.message, fatal: false }];
      return [];
    case "turn.completed":
      return [
        { kind: "usage", input: num(o.usage?.input_tokens), output: num(o.usage?.output_tokens) },
      ];
    case "turn.failed":
      return [{ kind: "error", message: str(o.error?.message) || "The turn failed.", fatal: true }];
    case "error":
      return str(o.message) ? [{ kind: "error", message: o.message, fatal: false }] : [];
    default:
      return [];
  }
}

/** @param {Record<string, any>} msg @returns {AgentEvent[]} */
function codexOld(msg) {
  switch (msg.type) {
    case "session_configured":
      return [
        ...(str(msg.session_id) ? [{ kind: "session", id: msg.session_id }] : []),
        ...(str(msg.model) ? [{ kind: "model", name: msg.model }] : []),
      ].map((e) => /** @type {AgentEvent} */ (e));
    case "agent_message":
      return str(msg.message) ? [{ kind: "text", text: msg.message, block: true }] : [];
    case "exec_command_begin":
      return [{ kind: "tool", name: "Run", detail: describe(msg.command) }];
    case "patch_apply_begin":
      return [{ kind: "tool", name: "Edit", detail: describe(Object.keys(msg.changes ?? {})) }];
    case "token_count":
      return [{ kind: "usage", input: num(msg.input_tokens), output: num(msg.output_tokens) }];
    case "task_complete":
      return str(msg.last_agent_message) ? [{ kind: "final", text: msg.last_agent_message }] : [];
    case "error":
    case "stream_error":
      return [{ kind: "error", message: str(msg.message) || "Codex failed.", fatal: false }];
    default:
      return [];
  }
}

/**
 * Gemini CLI's stream-json (init, message deltas, tool_use, result), or the one object that
 * `--output-format json` prints.
 * @param {Record<string, any>} o
 * @returns {AgentEvent[]}
 */
function geminiEvent(o) {
  switch (o.type) {
    case "init":
      return [
        ...(str(o.session_id) ? [{ kind: "session", id: o.session_id }] : []),
        ...(str(o.model) ? [{ kind: "model", name: o.model }] : []),
      ].map((e) => /** @type {AgentEvent} */ (e));
    case "message":
      if (o.role !== "assistant" || !str(o.content)) return [];
      return [{ kind: "text", text: o.content, ...(o.delta === true ? {} : { block: true }) }];
    case "tool_use":
      return [
        { kind: "tool", name: str(o.tool_name) || "tool", detail: describe(o.parameters ?? {}) },
      ];
    case "error":
      return [
        {
          kind: "error",
          message: str(o.message) || "Gemini failed.",
          fatal: o.severity === "error",
        },
      ];
    case "result": {
      /** @type {AgentEvent[]} */
      const out = [
        {
          kind: "usage",
          input: num(o.stats?.input_tokens),
          output: num(o.stats?.output_tokens),
        },
      ];
      if (o.status === "error")
        out.push({
          kind: "error",
          message: str(o.error?.message) || "Gemini failed.",
          fatal: true,
        });
      return out;
    }
    default:
      if (str(o.response)) return [{ kind: "text", text: o.response, block: true }];
      if (o.error && str(o.error.message))
        return [{ kind: "error", message: o.error.message, fatal: true }];
      return [];
  }
}

/**
 * Grok CLI's headless mode: chat messages as JSON lines (assistant text, tool calls), else text.
 * @param {Record<string, any>} o
 * @returns {AgentEvent[]}
 */
function grokEvent(o) {
  if (o.role !== "assistant") return [];
  /** @type {AgentEvent[]} */
  const out = [];
  for (const call of Array.isArray(o.tool_calls) ? o.tool_calls : []) {
    let args = call?.function?.arguments;
    try {
      args = typeof args === "string" ? JSON.parse(args) : args;
    } catch {}
    out.push({ kind: "tool", name: str(call?.function?.name) || "tool", detail: describe(args) });
  }
  if (str(o.content)) out.push({ kind: "text", text: o.content, block: true });
  return out;
}

const READERS = { claude: claudeEvent, codex: codexEvent, gemini: geminiEvent, grok: grokEvent };

/**
 * A reader for one run's stdout in `format`.
 * @param {Format} format
 * @returns {Reader}
 */
export function reader(format) {
  if (format === "text") return { line: asText, end: () => [] };
  const read = READERS[format];
  return {
    line(line) {
      const o = json(line);
      if (!o) return asText(line);
      // A JSON line of another shape (a status object a program prints first) says nothing.
      return format === "grok" && !("role" in o) ? [] : read(o);
    },
    end: () => [],
  };
}

/**
 * @typedef {{ text: string, final: string, session: string, model: string,
 *   tools: { name: string, detail: string }[], usage: { input?: number, output?: number, cost?: number },
 *   problems: string[], fatal: string }} Reply
 */

/** @returns {Reply} */
export function emptyReply() {
  return {
    text: "",
    final: "",
    session: "",
    model: "",
    tools: [],
    usage: {},
    problems: [],
    fatal: "",
  };
}

const TOOLS_KEPT = 50;

/**
 * Fold one event into the reply. Whole blocks are separated by a blank line; deltas run on.
 * @param {Reply} reply
 * @param {AgentEvent} event
 */
export function apply(reply, event) {
  switch (event.kind) {
    case "session":
      reply.session = event.id;
      break;
    case "model":
      reply.model = event.name;
      break;
    case "text":
      if (event.block && reply.text.trim()) reply.text = `${reply.text.trimEnd()}\n\n`;
      reply.text += event.text;
      break;
    case "final":
      reply.final = event.text;
      break;
    case "tool":
      if (reply.tools.push({ name: event.name, detail: event.detail }) > TOOLS_KEPT)
        reply.tools.shift();
      break;
    case "usage":
      for (const key of /** @type {const} */ (["input", "output", "cost"]))
        if (event[key] !== undefined) reply.usage[key] = event[key];
      break;
    case "error":
      if (event.fatal) reply.fatal = event.message;
      else if (reply.problems.push(event.message) > 5) reply.problems.shift();
      break;
  }
  return reply;
}

/** What the agent answered: its text, or the final result when it streamed none. */
export function answerOf(/** @type {Reply} */ reply) {
  return reply.text.trim() || reply.final.trim();
}
