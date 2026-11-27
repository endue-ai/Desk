// The Assistant panel: ask in words about the request in front, its response or the collection,
// or ask for something to be made. Each answer is a short reply and cards of actions (a new
// request, a change, tests, checks, docs, a variable) that apply only when the person says so.

import { applyAction } from "./ai-actions.js";
import { ANSWER_TOOL, promptFor } from "./ai-context.js";
import { button, h, icon, methodBadge } from "./dom.js";
import { markdown } from "./markdown.js";
import { methodClass } from "./model.js";
import { addRail, panelHead } from "./view-side.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./ai-actions.js").Action} Action
 * @typedef {{ question: string, reply?: string, actions?: (Action & { done?: string })[], error?: string, busy?: boolean }} Turn
 */

export const QUICK = [
  ["Why did this fail?", "alert"],
  ["Explain this response", "info"],
  ["Write tests for this response", "test"],
  ["Add checks for this response", "check"],
  ["Write docs for this request", "doc"],
];

const ICONS = /** @type {Record<string, import("./dom.js").IconName>} */ ({
  create_request: "plus",
  update_request: "edit",
  add_tests: "test",
  add_checks: "check",
  write_docs: "doc",
  set_variable: "variable",
});

/** @param {Studio} S */
export function installAssistant(S) {
  /** @type {Turn[]} */
  const turns = [];
  const changed = () => S.app.emit("assistant");

  /** Ask a question about what is in front. @param {string} question */
  S.askAI = async (question) => {
    const q = question.trim();
    if (!q) return;
    S.app.layout({
      rail: "assistant",
      side: true,
      sideWidth: Math.max(S.app.state.layout.sideWidth, 360),
    });
    /** @type {Turn} */
    const turn = { question: q, busy: true };
    turns.push(turn);
    changed();
    try {
      const answer = await S.asker.ask(promptFor(S, S.app.current(), q), ANSWER_TOOL);
      turn.reply = String(answer?.reply ?? "The brain answered in words only.");
      turn.actions = Array.isArray(answer?.actions) ? answer.actions : [];
    } catch (error) {
      turn.error = String(/** @type {any} */ (error)?.message ?? error);
    }
    turn.busy = false;
    changed();
  };
  S.explain = (/** @type {import("./app.js").Tab} */ _tab) =>
    S.askAI("Why did this fail, and how do I fix it?");

  /** @param {Action & { done?: string }} a */
  const card = (a) => {
    const r = a.request;
    const preview =
      a.kind === "create_request" || a.kind === "update_request"
        ? h(
            "div.ai-req",
            null,
            r?.method
              ? methodBadge(
                  String(r.method).toUpperCase(),
                  methodClass(String(r.method).toUpperCase()),
                )
              : null,
            h("span.ai-req-url", null, String(r?.url ?? "")),
          )
        : a.kind === "add_tests"
          ? h("pre.ai-code", null, String(a.code ?? "").slice(0, 600))
          : a.kind === "add_checks"
            ? h(
                "div.ai-checks",
                null,
                ...(a.checks ?? []).map((c) =>
                  h("code", null, `${c.target} ${c.op} ${c.value ?? ""}`),
                ),
              )
            : a.kind === "set_variable"
              ? h("code", null, `{{${a.variable?.name}}} = ${a.variable?.value}`)
              : null;
    return h(
      `div.ai-action${a.done ? ".is-done" : ""}`,
      null,
      h(
        "div.ai-action-head",
        null,
        icon(ICONS[a.kind] ?? "sparkle", 14),
        h("strong", null, a.title),
      ),
      preview,
      a.done
        ? h("span.ai-done", null, icon("check", 13), a.done)
        : button({
            label: "Apply",
            icon: "check",
            kind: "desk-btn-primary ai-apply",
            onClick: () => {
              try {
                a.done = applyAction(S, S.app.current(), a);
              } catch (error) {
                a.done = undefined;
                S.app.toast(String(/** @type {any} */ (error)?.message ?? error), "error");
              }
              changed();
            },
          }),
    );
  };

  const panel = () => {
    const log = h("div.ai-log");
    const input = /** @type {HTMLTextAreaElement} */ (
      h("textarea.desk-field.ai-input", {
        rows: 3,
        placeholder: "Ask about this request, or describe one to make…",
        "aria-label": "Ask the assistant",
      })
    );
    const send = () => {
      const q = input.value;
      input.value = "";
      void S.askAI(q);
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    const draw = () => {
      const tab = S.app.current();
      log.replaceChildren(
        ...(turns.length
          ? turns.map((t) =>
              h(
                "div.ai-turn",
                null,
                h("div.ai-q", null, t.question),
                t.busy
                  ? h("div.ai-a.is-busy", null, h("span.as-spin"), h("span", null, "Thinking…"))
                  : t.error
                    ? h("div.ai-a.is-error", null, icon("alert", 14), h("span", null, t.error))
                    : h(
                        "div.ai-a",
                        null,
                        markdown(t.reply ?? ""),
                        ...(t.actions ?? []).map((a) => card(a)),
                      ),
              ),
            )
          : [
              h(
                "div.ai-hello",
                null,
                h("div.ai-hello-mark", null, icon("sparkle", 22)),
                h("strong", null, "Ask about your API"),
                h(
                  "p.as-hint",
                  null,
                  tab && !tab.kind
                    ? `It sees “${tab.req.name}”, its last response and the collection; never a secret's value.`
                    : "Open a request to ask about it, or describe a request to make.",
                ),
              ),
            ]),
      );
      log.scrollTop = log.scrollHeight;
    };
    draw();
    const quick = h(
      "div.ai-quick",
      null,
      ...QUICK.map(([q, ic]) =>
        h(
          "button.desk-btn.desk-btn-quiet.ai-chip",
          { type: "button", onClick: () => S.askAI(q ?? "") },
          icon(/** @type {any} */ (ic), 13),
          q,
        ),
      ),
    );
    return {
      el: h(
        "div.as-panel.ai-panel",
        null,
        panelHead(
          "Assistant",
          button({
            label: "Clear the conversation",
            icon: "trash",
            hideLabel: true,
            onClick: () => {
              turns.length = 0;
              changed();
            },
          }),
        ),
        log,
        h(
          "div.ai-compose",
          null,
          quick,
          h(
            "div.ai-box",
            null,
            input,
            button({
              label: "Ask",
              icon: "send",
              hideLabel: true,
              kind: "desk-btn-primary ai-send",
              onClick: send,
            }),
          ),
        ),
      ),
      redraw: draw,
      topics: /** @type {import("./app.js").Topic[]} */ (["assistant", "tab"]),
    };
  };
  addRail({ id: "assistant", label: "Assistant", icon: "sparkle", order: 40, draw: panel });
}
