// Conversations: one per agent, a list of messages and the session the program opened, so the next
// message goes on from it (or, for a program that cannot resume, carries the earlier turns). Kept
// under `chat.<agent>`, cut to fit the desk's store.

import { isValue } from "./catalog.js";
import { clip, fitList, load, save, sizeOf, VALUE_LIMIT } from "./store.js";

/**
 * @typedef {"running" | "done" | "failed" | "stopped"} Status
 * @typedef {{ name: string, detail: string }} Tool
 * @typedef {{ id: string, role: "user" | "agent", text: string, at: number, status?: Status,
 *   error?: string, run?: string, tools?: Tool[], parts?: import("./parse.js").Reply["parts"], ms?: number,
 *   usage?: import("./parse.js").Reply["usage"] }} Message
 * @typedef {{ agent: string, session: string, model: string, messages: Message[] }} Conversation
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">} Bridge
 */

const TEXT_KEPT = 16_000;
const MESSAGES_KEPT = 200;

export const chatKey = (/** @type {string} */ agent) => `chat.${agent}`;

/** A conversation from what the store held, or a fresh one. */
export function readConversation(/** @type {string} */ agent, /** @type {unknown} */ value) {
  /** @type {Conversation} */
  const fresh = { agent, session: "", model: "", messages: [] };
  if (!value || typeof value !== "object") return fresh;
  const v = /** @type {Record<string, unknown>} */ (value);
  const messages = Array.isArray(v.messages) ? v.messages.filter(isMessage) : [];
  return {
    agent,
    session: isValue(v.session) ? /** @type {string} */ (v.session) : "",
    model: isValue(v.model) ? /** @type {string} */ (v.model) : "",
    // A message that was running when the desk closed did not finish.
    messages: messages.map((m) => {
      const clean = { ...m };
      if (clean.status === "running") clean.status = "stopped";
      if (clean.tools)
        clean.tools = Array.isArray(clean.tools)
          ? clean.tools.filter(
              (t) => t && typeof t.name === "string" && typeof t.detail === "string",
            )
          : [];
      if (clean.parts)
        clean.parts = Array.isArray(clean.parts)
          ? clean.parts
              .filter((p) => p && typeof p.text === "string")
              .map((p) => {
                if (
                  p.role === "plan" &&
                  (!Array.isArray(p.steps) ||
                    !p.steps.every(
                      (s) => s && typeof s.text === "string" && typeof s.state === "string",
                    ))
                )
                  return { role: "record", text: p.text };
                return [
                  "assistant",
                  "tool",
                  "failure",
                  "plan",
                  "notification",
                  "excerpt",
                  "record",
                ].includes(p.role)
                  ? p
                  : { role: "record", text: p.text };
              })
          : [];
      return clean;
    }),
  };
}

const isMessage = (/** @type {any} */ m) =>
  m &&
  typeof m.id === "string" &&
  (m.role === "user" || m.role === "agent") &&
  typeof m.text === "string" &&
  typeof m.at === "number";

/** What is written: the latest messages, long texts shortened, under the store's limit. */
export function storedConversation(/** @type {Conversation} */ c) {
  const messages = c.messages.slice(-MESSAGES_KEPT).map((m) => {
    const { run: _run, parts, ...rest } = m;
    const basic = {
      ...rest,
      text: clip(m.text, TEXT_KEPT),
      ...(m.tools ? { tools: m.tools.slice(-10) } : {}),
    };
    if (
      !parts?.length ||
      (parts.length === 1 &&
        parts[0]?.role === "assistant" &&
        parts[0].text.trim() === m.text.trim())
    )
      return basic;
    const withOrder = {
      ...basic,
      parts: parts.slice(-100).map((p) => ({
        ...p,
        text: clip(p.text, TEXT_KEPT),
        ...(p.text.length > TEXT_KEPT ? { cut: true } : {}),
      })),
    };
    // Preserve the original saved answer when its optional event details would evict it.
    return sizeOf({ ...c, messages: [withOrder] }) <= VALUE_LIMIT ? withOrder : basic;
  });
  const wrap = (/** @type {Message[]} */ kept) => ({ ...c, messages: kept });
  return wrap(fitList(messages, wrap));
}

/**
 * @param {Bridge} bridge
 * @param {{ now(): number, id(): string }} env
 */
export function createChats(bridge, env) {
  /** @type {Map<string, Conversation>} */
  const conversations = new Map();
  /** @type {Map<string, Promise<Conversation>>} */
  const loading = new Map();

  /** The agent's conversation, read from the store the first time. */
  const open = async (/** @type {string} */ agent) => {
    const known = conversations.get(agent);
    if (known) return known;
    let pending = loading.get(agent);
    if (!pending) {
      pending = load(bridge, chatKey(agent)).then((value) => {
        const c = conversations.get(agent) ?? readConversation(agent, value);
        conversations.set(agent, c);
        return c;
      });
      loading.set(agent, pending);
    }
    return pending;
  };

  /** The conversation as far as it is known, without waiting for the store. */
  const peek = (/** @type {string} */ agent) =>
    conversations.get(agent) ?? { agent, session: "", model: "", messages: [] };

  const persist = (/** @type {string} */ agent) => {
    const c = conversations.get(agent);
    if (c) void save(bridge, chatKey(agent), storedConversation(c));
  };

  /**
   * Add a message; it gets an id and the time.
   * @param {string} agent
   * @param {Omit<Message, "id" | "at">} message
   */
  const add = async (agent, message) => {
    const c = await open(agent);
    /** @type {Message} */
    const full = { id: env.id(), at: env.now(), ...message };
    c.messages.push(full);
    persist(agent);
    return full;
  };

  /**
   * Change a message in place; `keep` writes the conversation (a finished message).
   * @param {string} agent
   * @param {string} id
   * @param {Partial<Message>} patch
   * @param {boolean} [keep]
   */
  const update = (agent, id, patch, keep = false) => {
    const message = conversations.get(agent)?.messages.find((m) => m.id === id);
    if (!message) return;
    Object.assign(message, patch);
    if (keep) persist(agent);
  };

  /** Start over: no messages, no session. */
  const clear = async (/** @type {string} */ agent) => {
    const c = await open(agent);
    c.messages = [];
    c.session = "";
    persist(agent);
    return c;
  };

  /** Remember the session the program opened, and the model the person picked. */
  const setSession = (/** @type {string} */ agent, /** @type {string} */ session) => {
    const c = conversations.get(agent);
    if (!c || !isValue(session) || c.session === session) return;
    c.session = session;
    persist(agent);
  };
  const setModel = async (/** @type {string} */ agent, /** @type {string} */ model) => {
    const c = await open(agent);
    c.model = model === "" || isValue(model) ? model : c.model;
    persist(agent);
    return c.model;
  };

  /** The finished turns before the latest message, for a program that cannot resume. */
  const history = (/** @type {string} */ agent) =>
    peek(agent)
      .messages.filter((m) => m.status !== "running" && m.status !== "failed" && m.text.trim())
      .map((m) => ({ role: m.role, text: m.text }));

  return { open, peek, add, update, clear, setSession, setModel, history };
}
