// The chat panel's DOM, beside a local agent's card: the session's turns (the agent's answers as
// markdown, the tools it used under them), the reply as it streams, and the composer with the
// access switch, Send and Stop. The composer is the page's own, so what the person types survives
// every redraw. Enter sends (not while an input method is composing); Shift+Enter is a new line.

import { el, markdown } from "./dom.js";

/**
 * @typedef {import("./app.js").StudioShown} StudioShown
 * @typedef {import("./local-chat.js").ChatMessage} ChatMessage
 * @typedef {object} ChatViewActions
 * @property {(text: string) => Promise<boolean>} send
 * @property {() => void} stop
 * @property {(access: "read-only" | "agent") => void} access
 * @property {() => void} fresh
 * @property {(href: string) => void} link
 */

const STATE = { streaming: "Answering…", failed: "Failed", stopped: "Stopped", done: "" };

/**
 * @param {Document} doc
 * @param {ChatViewActions} actions
 */
export function createChatView(doc, actions) {
  const pick = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const panel = pick("chat");
  const log = pick("chat-log");
  const input = /** @type {HTMLTextAreaElement} */ (pick("chat-input"));
  const send = /** @type {HTMLButtonElement} */ (pick("chat-send"));
  const stop = /** @type {HTMLButtonElement} */ (pick("chat-stop"));
  const access = pick("chat-access");
  let drawn = "";

  const submit = async () => {
    const text = input.value;
    if (!text.trim()) return;
    if (await actions.send(text)) input.value = "";
  };
  // The frame may not submit forms (sandboxed with scripts only): Send and Enter send.
  send.addEventListener("click", () => void submit());
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void submit();
  });
  stop.addEventListener("click", () => actions.stop());
  pick("chat-new").addEventListener("click", () => actions.fresh());
  for (const choice of access.querySelectorAll("[data-access]"))
    choice.addEventListener("click", () =>
      actions.access(/** @type {"read-only" | "agent"} */ (choice.getAttribute("data-access"))),
    );

  const turn = (/** @type {ChatMessage} */ m) => {
    if (m.role === "tool")
      return el(
        doc,
        "li",
        { class: "turn tool" },
        el(doc, "span", { class: "tool-name", text: m.text }),
        m.tools[0]?.detail ? ` ${m.tools[0].detail}` : "",
      );
    const said = m.state && STATE[m.state];
    return el(
      doc,
      "li",
      { class: `turn ${m.role}`, "data-state": m.state ?? "" },
      el(doc, "span", { class: "sr-only", text: m.role === "user" ? "You:" : "Agent:" }),
      m.role === "assistant"
        ? m.text
          ? markdown(doc, m.text, actions.link)
          : null
        : el(doc, "p", { class: "plain", text: m.text }),
      m.tools.length
        ? el(
            doc,
            "ul",
            { class: "tools", "aria-label": "What the agent used" },
            ...m.tools.map((t) =>
              el(
                doc,
                "li",
                {},
                el(doc, "span", { class: "tool-name", text: t.name }),
                t.detail ? ` ${t.detail}` : "",
              ),
            ),
          )
        : null,
      said ? el(doc, "p", { class: "turn-state", text: said }) : null,
      m.error ? el(doc, "p", { class: "desk-error", text: m.error }) : null,
      m.cut ? el(doc, "p", { class: "desk-muted", text: "Cut at 8000 characters." }) : null,
    );
  };

  return {
    /** @param {StudioShown} s */
    show(s) {
      const chat = s.chat;
      panel.hidden = !chat || s.facet !== "chat";
      if (!chat || panel.hidden) return;
      const name = s.card.name;
      pick("chat-title").textContent =
        chat.title || (chat.sessionId ? "This session" : `New session with ${name}`);
      pick("chat-session").textContent = chat.sessionId
        ? `Continues ${chat.sessionId.slice(0, 8)}`
        : `In ${chat.folder}`;
      const note = pick("chat-note");
      const notes = [
        chat.runnable
          ? ""
          : `${name}'s program is not on this computer: its sessions can be read, not continued.`,
        chat.truncated ? "Earlier turns of this session are left out." : "",
      ].filter(Boolean);
      note.textContent = notes.join(" ");
      note.hidden = notes.length === 0;
      const key = JSON.stringify([chat.agent, chat.sessionId, chat.messages, chat.phase]);
      if (key !== drawn) {
        log.replaceChildren(
          ...(chat.messages.length
            ? chat.messages.map(turn)
            : [
                el(doc, "li", {
                  class: "desk-empty",
                  text:
                    chat.phase === "loading"
                      ? "Reading the session…"
                      : `Ask ${name} something. It answers read-only unless you allow changes.`,
                }),
              ]),
        );
        log.scrollTop = log.scrollHeight;
        drawn = key;
      }
      const error = pick("chat-error");
      error.textContent = chat.error ?? "";
      error.hidden = !chat.error;
      const busy = chat.phase !== "idle";
      input.disabled = !chat.runnable;
      input.placeholder = chat.sessionId ? `Continue with ${name}` : `Message ${name}`;
      send.disabled = busy || !chat.runnable;
      send.textContent = chat.phase === "sending" ? "Sending…" : "Send";
      stop.hidden = !(chat.phase === "running" || chat.phase === "stopping");
      stop.disabled = chat.phase === "stopping";
      stop.textContent = chat.phase === "stopping" ? "Stopping…" : "Stop";
      pick("chat-new").hidden = !chat.sessionId;
      for (const choice of access.querySelectorAll("[data-access]"))
        choice.setAttribute(
          "aria-checked",
          String(choice.getAttribute("data-access") === chat.access),
        );
      pick("chat-hint").textContent =
        chat.access === "agent"
          ? "It may change files and run commands: you are asked before each message goes."
          : "Read-only: it reads and answers, and changes nothing.";
    },
    /** Put the focus in the composer. */
    focus: () => input.focus(),
  };
}
