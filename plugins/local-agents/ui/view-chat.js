// The Chat view (one conversation with one agent: messages, the answer streaming in, what the
// agent used, a composer) and the Compare view (one question to several agents, their answers side
// by side). An element is drawn again only when what it shows changed, so a streaming answer does
// not redraw the whole conversation.

import { badge, button, el, fill, markdown, toolList } from "./dom.js";

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

export { createWorkspaceView as createChatView } from "./workspace-view.js";

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
  composer(form, input, (text) => act("askCompared", text));

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
    fill(
      bar,
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
