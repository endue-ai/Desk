// One message of the conversation: the person's as a bubble on the right, the model's in full width
// with its reasoning folded above it, then its stats (speed, tokens, time to the first one) and its
// actions: copy, ask again, the versions ‹ 2/3 ›, remove.
import { copyText, fill, h, icon, iconButton } from "./dom.js";
import { renderMarkdown } from "./markdown.js";
import { splitThink } from "./think.js";
import { branchOf, switchBranch } from "./threads.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./threads.js").Node} Node
 * @typedef {import("./threads.js").Thread} Thread
 */

/** "42.3 tok/s · 318 tokens · 0.21 s to first token · Stopped". @param {Node} node */
export function statsLine(node) {
  const s = node.stats;
  if (!s) return [];
  /** @type {string[]} */
  const parts = [];
  if (s.tokPerSec)
    parts.push(`${s.tokPerSec >= 100 ? Math.round(s.tokPerSec) : s.tokPerSec.toFixed(1)} tok/s`);
  if (s.tokens) parts.push(`${s.tokens.toLocaleString()} tokens`);
  if (s.ttftMs !== undefined) parts.push(`${(s.ttftMs / 1000).toFixed(2)} s to first token`);
  if (s.stopReason === "stopped") parts.push("Stopped");
  else if (s.stopReason === "length") parts.push("Hit the token limit");
  return parts;
}

/** The reasoning, folded: "Thought for 4.2 s" or, while it runs, "Thinking…". @param {string} text @param {{ live: boolean, ms?: number }} o */
function reasoningBlock(text, { live, ms }) {
  const summary = live
    ? "Thinking…"
    : ms
      ? `Thought for ${ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)} s`
      : "Reasoning";
  const details = h(
    "details.lm-reasoning",
    { open: live ? true : undefined, dataset: { live: live ? "1" : undefined } },
    h(
      "summary",
      null,
      icon("lightbulb"),
      h("span", null, summary),
      icon("chevronDown", "lm-caret"),
    ),
    h("div.lm-reasoning-body", null, text),
  );
  return details;
}

/**
 * Draw a message into a fresh element. `live` while it is being written.
 * @param {App} app @param {Thread} thread @param {Node} node @param {{ live?: boolean }} [o]
 */
export function messageEl(app, thread, node, o = {}) {
  const el = h("article.lm-msg", { dataset: { role: node.role, id: node.id } });
  drawMessage(app, thread, node, el, o);
  return el;
}

/** @param {App} app @param {Thread} thread @param {Node} node @param {HTMLElement} el @param {{ live?: boolean }} [o] */
export function drawMessage(app, thread, node, el, o = {}) {
  const live = Boolean(o.live);
  el.dataset.live = live ? "1" : "";
  if (node.role === "user") {
    fill(
      el,
      h(
        "div.lm-user",
        null,
        node.images?.length
          ? h(
              "div.lm-msg-images",
              null,
              node.images.map((i) =>
                h("img", { src: `data:${i.type};base64,${i.data}`, alt: i.name }),
              ),
            )
          : null,
        node.content ? h("div.lm-bubble", null, node.content) : null,
        actions(app, thread, node, live),
      ),
    );
    return;
  }
  const split = node.reasoning
    ? { reasoning: node.reasoning, content: node.content, open: false }
    : splitThink(node.content);
  const thinking = live && (split.open || (Boolean(node.reasoning) && !node.content));
  const body = h("div.lm-answer");
  if (split.content) renderMarkdown(body, split.content, { live });
  else if (live && !split.reasoning)
    body.append(h("div.lm-typing", { "aria-label": "Writing" }, h("i"), h("i"), h("i")));
  fill(
    el,
    h(
      "div.lm-assistant",
      null,
      h(
        "div.lm-msg-head",
        null,
        h("span.lm-avatar", null, icon("sparkle")),
        h("span.lm-msg-model", null, node.modelName ?? node.model ?? "Model"),
      ),
      split.reasoning
        ? reasoningBlock(split.reasoning, { live: thinking, ms: node.reasoningMs })
        : null,
      body,
      node.error
        ? h("div.lm-msg-error", { role: "alert" }, icon("x"), h("span", null, node.error))
        : null,
      live ? null : actions(app, thread, node, live),
    ),
  );
}

/** @param {App} app @param {Thread} thread @param {Node} node @param {boolean} live */
function actions(app, thread, node, live) {
  const { index, count } = branchOf(thread, node);
  const busy = Boolean(app.S.get().generating);
  const copy = iconButton("copy", "Copy", async (e) => {
    const button = /** @type {HTMLElement} */ (e.currentTarget);
    const text = node.role === "assistant" ? splitThink(node.content).content : node.content;
    if (await copyText(text)) {
      fill(button, icon("check"));
      setTimeout(() => fill(button, icon("copy")), 1200);
    } else app.toast("The clipboard refused.", "error");
  });
  const stats = node.role === "assistant" ? statsLine(node) : [];
  return h(
    "div.lm-msg-foot",
    { dataset: { role: node.role } },
    count > 1
      ? h(
          "div.lm-branch",
          { "aria-label": `Version ${index} of ${count}` },
          iconButton(
            "chevronLeft",
            "Previous version",
            () => {
              switchBranch(thread, node.id, -1);
              app.S.touch("thread");
              app.persist(thread);
            },
            { disabled: index <= 1 || busy },
          ),
          h("span.lm-branch-count", null, `${index} / ${count}`),
          iconButton(
            "chevronRight",
            "Next version",
            () => {
              switchBranch(thread, node.id, 1);
              app.S.touch("thread");
              app.persist(thread);
            },
            { disabled: index >= count || busy },
          ),
        )
      : null,
    h(
      "div.lm-msg-actions",
      null,
      copy,
      node.role === "assistant"
        ? iconButton("refresh", "Ask again", () => void app.regenerate(node.id), { disabled: busy })
        : null,
      iconButton("trash", "Remove this and what follows", () => app.deleteNode(node.id), {
        disabled: busy || live,
      }),
    ),
    stats.length
      ? h(
          "div.lm-stats",
          null,
          stats.map((s) => h("span", null, s)),
        )
      : null,
  );
}
