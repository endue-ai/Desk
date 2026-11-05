// brain-echo's state: sessions, leases and turns, as specs/brain/v0/openapi.yaml describes them.
// server.mjs only carries this over HTTP. The answer to a message is the message itself; a message
// that starts with "tool:" asks Desk to run the echo tool first and answers with what it returned,
// and "tool <name> as <agent>: <json arguments>" asks for that tool on behalf of that agent. A
// message of several such calls (one per line, or joined by " then ") asks for each in turn, all in
// one turn. A turn that offers tools gets a call to the one toolChoice names, or to the first it
// knows: propose_theme (theme.mjs), propose_universal_view (universal.mjs) and echo; else to the
// local-agents ask command when the message names a local agent ("ask Claude to run the tests", ADR
// 0099); else to an offered command the message names by the words of its tool name (Eris's loop,
// ADR 0089: "check my latest mail" calls endue_mail_latest); "remember that <fact>" calls the desk's
// desk-remember when offered (ADR 0096).
import { proposeTheme } from "./theme.mjs";
import { proposeUniversalView } from "./universal.mjs";

/** A contract error: the HTTP status and the BrainError body. */
export class BrainError extends Error {
  constructor(status, code, message, holder) {
    super(message);
    this.status = status;
    this.code = code;
    this.holder = holder;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.holder ? { holder: this.holder } : {}),
    };
  }
}

const invalid = (message) => new BrainError(400, "invalid_request", message);
const notFound = (message) => new BrainError(404, "not_found", message);
const conflict = (code, message, holder) => new BrainError(409, code, message, holder);

/**
 * A clock in milliseconds where one second lasts `secondMs` real milliseconds, so tests can watch a
 * five-second lease expire in 100 ms. Timestamps the brain reports are on this clock.
 */
export function scaledClock(secondMs = 1000, now = Date.now) {
  const start = now();
  return () => start + ((now() - start) * 1000) / secondMs;
}

const iso = (ms) => new Date(ms).toISOString();

// Request bodies, checked against the contract's schemas by hand to keep the example dependency-free.
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const only = (v, keys) => Object.keys(v).every((key) => keys.includes(key));
const text = (v) => typeof v === "string";
const id = (v) => text(v) && v.length > 0;
const optional = (v, check) => v === undefined || check(v);
const ttl = (v) => Number.isInteger(v) && v >= 5 && v <= 3600;
const holder = (v) =>
  isObject(v) && only(v, ["deskId", "name"]) && id(v.deskId) && optional(v.name, text);
const part = (v) => isObject(v) && only(v, ["type", "text"]) && v.type === "text" && text(v.text);
const message = (v) =>
  isObject(v) &&
  only(v, ["role", "content"]) &&
  v.role === "user" &&
  Array.isArray(v.content) &&
  v.content.length > 0 &&
  v.content.every(part);

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const toolName = (v) => text(v) && TOOL_NAME.test(v);
const toolDefinition = (v) =>
  isObject(v) &&
  only(v, ["name", "description", "schema"]) &&
  toolName(v.name) &&
  id(v.description) &&
  isObject(v.schema);
const tools = (v) => Array.isArray(v) && v.length >= 1 && v.length <= 32 && v.every(toolDefinition);
const toolChoice = (v) =>
  isObject(v) &&
  (((v.type === "auto" || v.type === "required") && only(v, ["type"])) ||
    (v.type === "tool" && only(v, ["type", "name"]) && toolName(v.name)));

/** What the desk tells a turn (Desk ADR 0096): facts, episodes and working context; read, not used. */
const turnContext = (v) =>
  isObject(v) &&
  only(v, ["facts", "episodes", "working"]) &&
  optional(v.facts, Array.isArray) &&
  optional(v.episodes, Array.isArray) &&
  optional(v.working, (w) => isObject(w) && typeof w.now === "string");

/**
 * "remember that <fact>" on a turn that offers the desk's desk-remember: the call that keeps the
 * fact (Desk ADR 0096), so tests can script Eris remembering.
 */
function rememberCall(body, said) {
  const fact = /^remember that\s+([\s\S]+)$/i.exec(said.trim());
  const offered = (body.tools ?? []).some((t) => t.name === "desk-remember");
  return fact && offered ? { name: "desk-remember", arguments: { text: fact[1].trim() } } : null;
}

/** The tools brain-echo can call: each makes the arguments from what was said. */
const KNOWN = {
  propose_theme: (said) => proposeTheme(said),
  propose_universal_view: (said) => proposeUniversalView(said),
  echo: (said) => ({ text: said }),
};

const BODIES = {
  CreateSessionRequest: (b) =>
    only(b, ["title", "client"]) &&
    optional(b.title, text) &&
    isObject(b.client) &&
    only(b.client, ["name", "version"]) &&
    id(b.client.name) &&
    id(b.client.version),
  LeaseAcquireRequest: (b) =>
    only(b, ["holder", "ttlSeconds", "takeover"]) &&
    holder(b.holder) &&
    ttl(b.ttlSeconds) &&
    optional(b.takeover, (v) => typeof v === "boolean"),
  LeaseRenewRequest: (b) => only(b, ["ttlSeconds"]) && optional(b.ttlSeconds, ttl),
  TurnRequest: (b) =>
    only(b, ["leaseId", "message", "tools", "toolChoice", "context"]) &&
    id(b.leaseId) &&
    message(b.message) &&
    optional(b.tools, tools) &&
    optional(b.toolChoice, toolChoice) &&
    optional(b.context, turnContext),
  ToolResultRequest: (b) =>
    only(b, ["leaseId", "callId", "output", "isError"]) &&
    id(b.leaseId) &&
    id(b.callId) &&
    "output" in b &&
    optional(b.isError, (v) => typeof v === "boolean"),
};

function check(name, body) {
  if (!isObject(body) || !BODIES[name](body)) throw invalid(`The body is not a ${name}.`);
  return body;
}

/** The tool a turn calls: the one toolChoice names, else the first offered that brain-echo knows. */
function chosenTool(body) {
  const offered = body.tools ?? [];
  const choice = body.toolChoice;
  if (choice && offered.length === 0) throw invalid("toolChoice needs tools.");
  if (choice?.type === "tool") {
    const named = offered.find((t) => t.name === choice.name);
    if (!named) throw invalid(`toolChoice names ${choice.name}, which the turn does not offer.`);
    return named.name;
  }
  return offered.find((t) => t.name in KNOWN)?.name;
}

/**
 * An offered command the message names: every word of its tool name after the first, the
 * publisher, is in the message ("latest" and "mail" of endue_mail_latest). Command tools are named
 * with underscores (ADR 0088), so desk-tools and desk-run never match. Only when the turn leaves the
 * choice to the brain.
 */
function namedTool(body, said) {
  if (body.toolChoice && body.toolChoice.type !== "auto") return undefined;
  const words = new Set(said.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  return (body.tools ?? []).find((t) => {
    const parts = t.name.toLowerCase().split("_").slice(1);
    return parts.length > 0 && parts.every((part) => words.has(part));
  })?.name;
}

/** The local agents a message may name (plugins/local-agents), and the command that asks one. */
const LOCAL_AGENT = /\b(claude|codex|gemini|grok|qwen|copilot|cursor|opencode)\b/i;
const ASK_LOCAL = "endue_local-agents_ask";

/** A call of the offered ask command for the local agent the message names, the whole message as
 * the prompt. Only when the turn leaves the choice to the brain. */
function localAgentCall(body, said) {
  if (body.toolChoice && body.toolChoice.type !== "auto") return undefined;
  if (!(body.tools ?? []).some((t) => t.name === ASK_LOCAL)) return undefined;
  const agent = LOCAL_AGENT.exec(said)?.[1]?.toLowerCase();
  return agent && { name: ASK_LOCAL, arguments: { agent, prompt: said.trim() } };
}

/** Answer text as stream events: one text.delta per word, spaces kept. */
function deltas(turnId, said) {
  return (said.match(/\S+\s*|\s+/g) ?? []).map((piece) => ({
    type: "text.delta",
    turnId,
    text: piece,
  }));
}

/**
 * The tool calls a message asks for, in order: one per part when the message is several tool calls,
 * one per line or joined by " then ", else the one the whole message asks for. Null for any other
 * message.
 */
function toolCalls(said) {
  const lines = said.split(/\n|\s+then\s+(?=tool[\s:])/).filter((line) => line.trim() !== "");
  if (lines.length > 1) {
    const calls = lines.map((line) => toolCall(line.trim()));
    if (calls.every(Boolean)) return calls;
  }
  const call = toolCall(said);
  return call ? [call] : null;
}

/**
 * The tool call a message asks for, without its callId: "tool: <text>" is echo with { text },
 * "tool <name> [as <agent>]: <arguments>" is <name> with the JSON object (else { text }), for the
 * agent when one is named. Null for any other message.
 */
function toolCall(said) {
  const echo = /^tool:\s*([\s\S]*)$/.exec(said);
  if (echo) return { name: "echo", arguments: { text: echo[1] } };
  const named =
    /^tool\s+([A-Za-z0-9_.-]+)(?:\s+as\s+([A-Za-z0-9][A-Za-z0-9_.-]*))?:\s*([\s\S]*)$/.exec(said);
  if (!named) return null;
  const [, name, agentId, rest] = named;
  let args;
  try {
    args = JSON.parse(rest);
  } catch {
    args = null;
  }
  return {
    name,
    arguments: isObject(args) ? args : { text: rest },
    ...(agentId ? { agentId } : {}),
  };
}

export class EchoBrain {
  #now;
  #sessions = new Map();
  #next = 0;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  #id(prefix) {
    this.#next += 1;
    return `${prefix}${this.#next}`;
  }

  #session(sessionId) {
    const session = this.#sessions.get(sessionId);
    if (!session) throw notFound(`There is no session ${sessionId}.`);
    return session;
  }

  /** The lease in force, or null. A lease past its expiresAt ends here. */
  #current(session) {
    const lease = session.lease;
    if (lease && Date.parse(lease.expiresAt) <= this.#now()) {
      session.ended.set(lease.leaseId, "expired");
      session.lease = null;
    }
    return session.lease;
  }

  /** Only the holder of the lease in force may write. */
  #writer(session, leaseId) {
    const lease = this.#current(session);
    if (lease?.leaseId === leaseId) return lease;
    const ended = session.ended.get(leaseId);
    if (ended === "lost") {
      throw conflict("lease_lost", `Lease ${leaseId} was taken over.`, lease?.holder);
    }
    if (lease && !ended) {
      const name = lease.holder.name ?? lease.holder.deskId;
      throw conflict("lease_held", `Session ${session.id} is open on ${name}.`, lease.holder);
    }
    throw conflict("lease_expired", `Lease ${leaseId} is no longer in force; acquire it again.`);
  }

  #json(session) {
    const lease = this.#current(session);
    return {
      id: session.id,
      ...(session.title === undefined ? {} : { title: session.title }),
      status: "active",
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      ...(lease ? { lease } : {}),
    };
  }

  createSession(body) {
    check("CreateSessionRequest", body);
    const at = iso(this.#now());
    const session = {
      id: this.#id("s"),
      title: body.title,
      createdAt: at,
      updatedAt: at,
      lease: null,
      ended: new Map(),
      calls: new Map(),
    };
    this.#sessions.set(session.id, session);
    return this.#json(session);
  }

  getSession(sessionId) {
    return this.#json(this.#session(sessionId));
  }

  getLease(sessionId) {
    const lease = this.#current(this.#session(sessionId));
    if (!lease) throw notFound(`Session ${sessionId} has no lease in force.`);
    return lease;
  }

  acquireLease(sessionId, body) {
    check("LeaseAcquireRequest", body);
    const session = this.#session(sessionId);
    const current = this.#current(session);
    const same = current?.holder.deskId === body.holder.deskId;
    if (current && !same && !body.takeover) {
      const name = current.holder.name ?? current.holder.deskId;
      throw conflict("lease_held", `Session ${sessionId} is open on ${name}.`, current.holder);
    }
    if (current) session.ended.set(current.leaseId, same ? "released" : "lost");
    const now = this.#now();
    session.lease = {
      leaseId: this.#id("l"),
      sessionId,
      holder: body.holder,
      acquiredAt: iso(now),
      expiresAt: iso(now + body.ttlSeconds * 1000),
      ttlSeconds: body.ttlSeconds,
    };
    return session.lease;
  }

  renewLease(sessionId, leaseId, body) {
    check("LeaseRenewRequest", body ?? {});
    const lease = this.#writer(this.#session(sessionId), leaseId);
    lease.ttlSeconds = body?.ttlSeconds ?? lease.ttlSeconds;
    lease.expiresAt = iso(this.#now() + lease.ttlSeconds * 1000);
    return lease;
  }

  releaseLease(sessionId, leaseId) {
    const session = this.#session(sessionId);
    this.#writer(session, leaseId);
    session.ended.set(leaseId, "released");
    session.lease = null;
  }

  /**
   * The events of a new turn. A call to an offered tool, or a "tool:" or "tool <name>" message, stops
   * at tool_call until submitToolResult; one of several tool lines asks for the next after each
   * result.
   */
  startTurn(sessionId, body) {
    check("TurnRequest", body);
    const chosen = chosenTool(body);
    const session = this.#session(sessionId);
    this.#writer(session, body.leaseId);
    session.updatedAt = iso(this.#now());
    const said = body.message.content.map((p) => p.text).join("");
    const turnId = this.#id("turn");
    const started = { type: "turn.started", turnId };
    const answer = (text) => [
      started,
      ...deltas(turnId, text),
      { type: "turn.completed", turnId, stopReason: "end_turn" },
    ];
    const ask = (calls) => [started, ...this.#ask(session, turnId, calls)];
    if (chosen && KNOWN[chosen]) return ask([{ name: chosen, arguments: KNOWN[chosen](said) }]);
    if (chosen || (body.toolChoice && body.toolChoice.type !== "auto")) {
      const names = (body.tools ?? []).map((t) => t.name).join(", ");
      return answer(`brain-echo cannot call ${names}, so it answers in words: ${said}`);
    }
    const remember = rememberCall(body, said);
    if (remember) return ask([remember]);
    const calls = toolCalls(said.trim());
    if (calls) return ask(calls);
    const delegated = localAgentCall(body, said);
    if (delegated) return ask([delegated]);
    const named = namedTool(body, said);
    return named ? ask([{ name: named, arguments: {} }]) : answer(said);
  }

  /** Ask for the first of `calls`; the rest wait for its result. */
  #ask(session, turnId, [asked, ...rest]) {
    const call = { callId: this.#id("call"), ...asked };
    session.calls.set(turnId, { call, rest });
    return [
      ...deltas(turnId, `Let me ask the ${call.name} tool. `),
      { type: "tool.call", turnId, call },
      { type: "turn.completed", turnId, stopReason: "tool_call" },
    ];
  }

  /** The rest of a turn once the tool's result is in. */
  submitToolResult(sessionId, turnId, body) {
    check("ToolResultRequest", body);
    const session = this.#session(sessionId);
    this.#writer(session, body.leaseId);
    const waiting = session.calls.get(turnId);
    if (!waiting) throw notFound(`Turn ${turnId} is not waiting for a tool result.`);
    const { call, rest } = waiting;
    if (call.callId !== body.callId)
      throw notFound(`Turn ${turnId} waits for ${call.callId}, not ${body.callId}.`);
    session.calls.delete(turnId);
    session.updatedAt = iso(this.#now());
    const output =
      typeof body.output?.text === "string" ? body.output.text : JSON.stringify(body.output);
    const tool = `The ${call.name} tool`;
    const said = body.isError ? `${tool} failed: ${output}` : `${tool} said: ${output}`;
    if (rest.length > 0)
      return [...deltas(turnId, `${said} `), ...this.#ask(session, turnId, rest)];
    return [...deltas(turnId, said), { type: "turn.completed", turnId, stopReason: "end_turn" }];
  }
}
