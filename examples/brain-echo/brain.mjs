// brain-echo's state: sessions, leases and turns, as specs/brain/v0/openapi.yaml describes them.
// server.mjs only carries this over HTTP. The answer to a message is the message itself; a message
// that starts with "tool:" asks Desk to run the echo tool first and answers with what it returned.

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
  TurnRequest: (b) => only(b, ["leaseId", "message"]) && id(b.leaseId) && message(b.message),
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

/** Answer text as stream events: one text.delta per word, spaces kept. */
function deltas(turnId, said) {
  return (said.match(/\S+\s*|\s+/g) ?? []).map((piece) => ({
    type: "text.delta",
    turnId,
    text: piece,
  }));
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

  /** The events of a new turn. A "tool:" message stops at tool_call until submitToolResult. */
  startTurn(sessionId, body) {
    check("TurnRequest", body);
    const session = this.#session(sessionId);
    this.#writer(session, body.leaseId);
    session.updatedAt = iso(this.#now());
    const said = body.message.content.map((p) => p.text).join("");
    const turnId = this.#id("turn");
    const started = { type: "turn.started", turnId };
    const tool = /^tool:\s*([\s\S]*)$/.exec(said.trim());
    if (!tool) {
      return [
        started,
        ...deltas(turnId, said),
        { type: "turn.completed", turnId, stopReason: "end_turn" },
      ];
    }
    const call = { callId: this.#id("call"), name: "echo", arguments: { text: tool[1] } };
    session.calls.set(turnId, call.callId);
    return [
      started,
      ...deltas(turnId, "Let me ask the echo tool. "),
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
    if (waiting !== body.callId)
      throw notFound(`Turn ${turnId} waits for ${waiting}, not ${body.callId}.`);
    session.calls.delete(turnId);
    session.updatedAt = iso(this.#now());
    const output =
      typeof body.output?.text === "string" ? body.output.text : JSON.stringify(body.output);
    const said = body.isError ? `The echo tool failed: ${output}` : `The echo tool said: ${output}`;
    return [...deltas(turnId, said), { type: "turn.completed", turnId, stopReason: "end_turn" }];
  }
}
