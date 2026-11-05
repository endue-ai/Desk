// The Chat view (one conversation with one agent: messages, the answer streaming in, what the
// agent used, a composer) and the Compare view (one question to several agents, their answers side
// by side). An element is drawn again only when what it shows changed, so a streaming answer does
// not redraw the whole conversation.

import { badge, button, el, markdown, toolList } from "./dom.js";

/**
 * @typedef {import("./dom.js").Act} Act
 * @typedef {import("./model.js").ViewModel} ViewModel
 * @typedef {import("./model.js").MessageModel} MessageModel
 * @typedef {import("./model.js").PaneModel} PaneModel
 */

/** Elements kept by key and drawn again when their signature changes. */
function keyed() {
  /** @type {Map<string, { sig: string, node: HTMLElement }>} */
  const kept = new Map();
  return {
    /**
     * @param {string} key
     * @param {string} sig
     * @param {() => HTMLElement} draw
     */
    get(key, sig, draw) {
      const old = kept.get(key);
      if (old && old.sig === sig) return old.node;
      const node = draw();
      kept.set(key, { sig, node });
      return node;
    },
    keep(/** @type {Set<string>} */ keys) {
      for (const key of [...kept.keys()]) if (!keys.has(key)) kept.delete(key);
    },
  };
}

/**
 * Enter sends, Shift+Enter makes a new line; an empty text sends nothing.
 * @param {HTMLFormElement} form
 * @param {HTMLTextAreaElement} input
 * @param {(text: string) => unknown} send
 */
function composer(form, input, send) {
  const submit = () => {
    const text = input.value;
    if (!text.trim()) return;
    input.value = "";
    void send(text);
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      submit();
    }
  });
}

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createChatView(doc, act) {
  const bar = /** @type {HTMLElement} */ (doc.getElementById("chat-bar"));
  const log = /** @type {HTMLElement} */ (doc.getElementById("chat-log"));
  const form = /** @type {HTMLFormElement} */ (doc.getElementById("chat-form"));
  const input = /** @type {HTMLTextAreaElement} */ (doc.getElementById("chat-input"));
  const send = /** @type {HTMLButtonElement} */ (doc.getElementById("chat-send"));
  const messages = keyed();
  let shownAgent = "";
  composer(form, input, (text) => act("send", text));

  /** @param {MessageModel} m @param {string} name */
  const draw = (m, name) =>
    el(
      doc,
      "article",
      { class: `msg ${m.role} ${m.status}`, "aria-busy": String(m.status === "running") },
      el(
        doc,
        "header",
        {},
        el(doc, "span", { class: "who" }, m.role === "user" ? "You" : name),
        m.role === "agent" && m.status !== "done" ? badge(doc, m.status) : undefined,
        m.meta ? el(doc, "span", { class: "meta" }, m.meta) : undefined,
      ),
      m.role === "user"
        ? el(doc, "p", { class: "said" }, m.text)
        : m.text
          ? markdown(doc, m.text)
          : el(doc, "p", { class: "note" }, m.status === "running" ? "Thinking…" : "No answer."),
      m.role === "agent" ? toolList(doc, m.tools) : undefined,
      m.error && m.status !== "stopped" ? el(doc, "p", { class: "problem" }, m.error) : undefined,
    );

  /** @param {ViewModel} model */
  const render = (model) => {
    const { chat, agents } = model;
    const found = agents.filter((a) => a.state === "ready");
    bar.replaceChildren(
      el(
        doc,
        "div",
        { class: "picker", role: "group", "aria-label": "Talk to" },
        ...found.map((a) =>
          button(doc, a.name, act, "useAgent", [a.id], {
            "aria-pressed": String(a.id === chat.agent),
          }),
        ),
      ),
      chat.agent
        ? button(doc, chat.model ? `Model: ${chat.model}` : "Model: default", act, "pickModel")
        : undefined,
      chat.agent ? button(doc, "New conversation", act, "newChat") : undefined,
      chat.running ? button(doc, "Stop", act, "stopChat", [], { class: "danger" }) : undefined,
      chat.agent
        ? el(
            doc,
            "span",
            { class: "note" },
            chat.resumes
              ? chat.session
                ? "Goes on in its own session"
                : "Opens its own session"
              : "Earlier turns go in each prompt",
          )
        : undefined,
    );
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    if (chat.agent !== shownAgent) messages.keep(new Set());
    shownAgent = chat.agent;
    const nodes = chat.messages.map((m) =>
      messages.get(
        m.id,
        [m.status, m.text.length, m.text.slice(-32), m.error, m.tools.length, m.meta].join("|"),
        () => draw(m, chat.name),
      ),
    );
    messages.keep(new Set(chat.messages.map((m) => m.id)));
    if (nodes.length === 0)
      log.replaceChildren(
        el(
          doc,
          "p",
          { class: "note empty" },
          chat.agent
            ? chat.ready
              ? `Ask ${chat.name} anything. It answers in the folder the settings name.`
              : `${chat.name} is not ready: see the Agents view.`
            : "No agent program is installed yet: see the Agents view.",
        ),
      );
    else log.replaceChildren(...nodes);
    if (atEnd) log.scrollTop = log.scrollHeight;
    input.disabled = !chat.ready;
    send.disabled = !chat.ready || chat.running;
  };

  return {
    render,
    focus: () => input.focus(),
    /** @param {string} action */
    key(action) {
      if (action !== "focusComposer") return false;
      input.focus();
      return true;
    },
  };
}

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createCompareView(doc, act) {
  const bar = /** @type {HTMLElement} */ (doc.getElementById("compare-bar"));
  const form = /** @type {HTMLFormElement} */ (doc.getElementById("compare-form"));
  const input = /** @type {HTMLTextAreaElement} */ (doc.getElementById("compare-input"));
  const send = /** @type {HTMLButtonElement} */ (doc.getElementById("compare-send"));
  const panesEl = /** @type {HTMLElement} */ (doc.getElementById("compare-panes"));
  const panes = keyed();
  composer(form, input, (text) => act("compare", text));

  /** @param {PaneModel} p */
  const draw = (p) =>
    el(
      doc,
      "article",
      { class: `pane ${p.status}`, "aria-busy": String(p.status === "running") },
      el(
        doc,
        "header",
        {},
        el(doc, "strong", {}, p.name),
        badge(doc, p.status),
        el(doc, "span", { class: "meta" }, p.meta),
      ),
      p.text
        ? markdown(doc, p.text)
        : el(doc, "p", { class: "note" }, p.status === "running" ? "Thinking…" : "No answer."),
      toolList(doc, p.tools),
      p.error && p.status !== "stopped" ? el(doc, "p", { class: "problem" }, p.error) : undefined,
    );

  /** @param {ViewModel} model */
  const render = (model) => {
    const { compare } = model;
    const found = model.agents.filter((a) => a.state === "ready");
    const picked = found.filter((a) => compare.picked.includes(a.id)).length;
    bar.replaceChildren(
      ...found.map((a) =>
        button(doc, a.name, act, "toggleCompared", [a.id], {
          "aria-pressed": String(compare.picked.includes(a.id)),
        }),
      ),
      compare.running
        ? button(doc, "Stop", act, "stopCompare", [], { class: "danger" })
        : undefined,
      found.length === 0
        ? el(doc, "span", { class: "note" }, "No agent program is installed yet.")
        : undefined,
    );
    send.textContent = picked === 1 ? "Ask 1 agent" : `Ask ${picked} agents`;
    send.disabled = picked === 0 || compare.running;
    const nodes = compare.panes.map((p) =>
      panes.get(
        p.agent,
        [p.status, p.text.length, p.text.slice(-32), p.error, p.tools.length, p.meta].join("|"),
        () => draw(p),
      ),
    );
    panes.keep(new Set(compare.panes.map((p) => p.agent)));
    panesEl.replaceChildren(
      ...(compare.prompt
        ? [el(doc, "p", { class: "asked" }, el(doc, "strong", {}, "Asked: "), compare.prompt)]
        : []),
      el(doc, "div", { class: "panes" }, ...nodes),
    );
  };

  return {
    render,
    focus: () => input.focus(),
    /** @param {string} action */
    key(action) {
      if (action !== "focusComposer") return false;
      input.focus();
      return true;
    },
  };
}
