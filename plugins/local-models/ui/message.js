// One message of the conversation: the person's as a bubble on the right, the model's in full width
// with its reasoning folded above it, then its stats (speed, tokens, time to the first one) and its
// actions: copy, edit, ask again, go on, the versions ‹ 2/3 ›, a new chat from here, remove. While it
// streams, its head shows the live speed.
import { copyText, fill, h, icon, iconButton } from "./dom.js";
import { branchToNew, continueAnswer, editAnswer, editQuestion } from "./edit.js";
import { renderMarkdown } from "./markdown.js";
import { openMenu } from "./menu.js";
import { splitThink } from "./think.js";
import { branchOf, path, switchBranch } from "./threads.js";

/**
 * @typedef {import("./app.js").App} App
 * @typedef {import("./threads.js").Node} Node
 * @typedef {import("./threads.js").Thread} Thread
 * @typedef {{ live?: boolean, speed?: number }} DrawOptions
 */

/** Messages being edited, with what the field holds, kept across redraws. @type {Map<string, string>} */
const editing = new Map();
/** The blocks of each answer as last drawn, so a streaming answer redraws only its end. @type {Map<string, import("./markdown.js").BlockCache>} */
const drawn = new Map();

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
  if (node.edited) parts.push("Edited");
  return parts;
}

/** The reasoning, folded: "Thought for 4.2 s" or, while it runs, "Thinking…". @param {string} text @param {{ live: boolean, ms?: number }} o */
function reasoningBlock(text, { live, ms }) {
  const summary = live
    ? "Thinking…"
    : ms
      ? `Thought for ${ms < 10000 ? (ms / 1000).toFixed(1) : Math.round(ms / 1000)} s`
      : "Reasoning";
  return h(
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
}

/** The passages a question was sent with, folded: which files, how they were found. @param {Node} node */
function sourcesBlock(node) {
  const sources = node.sources ?? [];
  const files = [...new Set(sources.map((s) => s.doc))];
  return h(
    "details.lm-sources",
    null,
    h(
      "summary",
      null,
      icon("search"),
      h("span", null, `${sources.length} passages from ${files.join(", ")}`),
      h(
        "span.lm-muted",
        null,
        node.searched === "words"
          ? " · by its words"
          : node.searched
            ? ` · by ${node.searched}`
            : "",
      ),
    ),
    h(
      "ol.lm-source-list",
      null,
      sources.map((s) =>
        h(
          "li",
          null,
          h("span.lm-source-doc", null, s.doc),
          h("span.lm-source-text", null, `${s.excerpt.replace(/\s+/g, " ")}…`),
        ),
      ),
    ),
  );
}

/** A JSON answer as a fenced block, indented once it parses. @param {string} text @param {boolean} live */
function jsonBlock(text, live) {
  let body = text.trim().replace(/^```(?:json)?\s*|```\s*$/g, "");
  if (!live)
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch {}
  return `\`\`\`json\n${body}${live ? "" : "\n```"}`;
}

/** @param {App} app @param {Thread} thread @param {Node} node @param {DrawOptions} [o] */
export function messageEl(app, thread, node, o = {}) {
  const el = h("article.lm-msg", { dataset: { role: node.role, id: node.id } });
  drawMessage(app, thread, node, el, o);
  return el;
}

/** The field a message is edited in, with Cancel and Save. @param {App} app @param {Node} node */
function editor(app, node) {
  const field = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.lm-edit-field", {
      "aria-label": node.role === "user" ? "Edit your message" : "Edit the answer",
    })
  );
  field.value = editing.get(node.id) ?? node.content;
  const fitHeight = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight + 2, 420)}px`;
  };
  const close = () => {
    editing.delete(node.id);
    app.S.touch("thread");
  };
  const save = () => {
    const text = field.value;
    editing.delete(node.id);
    if (node.role === "user") void editQuestion(app, node.id, text);
    else editAnswer(app, node.id, text);
  };
  field.addEventListener("input", () => {
    editing.set(node.id, field.value);
    fitHeight();
  });
  field.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      save();
    }
  });
  requestAnimationFrame(() => {
    fitHeight();
    field.focus();
  });
  return h(
    "div.lm-editor",
    { dataset: { role: node.role } },
    field,
    h(
      "div.lm-editor-bar",
      null,
      h(
        "span.lm-editor-hint",
        null,
        node.role === "user"
          ? "A new version of the question, answered again"
          : "The model sees the corrected answer",
      ),
      h("button.desk-btn.desk-btn-quiet", { type: "button", onClick: close }, "Cancel"),
      h(
        "button.desk-btn.desk-btn-primary",
        { type: "button", onClick: save },
        node.role === "user" ? "Save and send" : "Save",
      ),
    ),
  );
}

/** @param {App} app @param {Thread} thread @param {Node} node @param {HTMLElement} el @param {DrawOptions} [o] */
export function drawMessage(app, thread, node, el, o = {}) {
  const live = Boolean(o.live);
  el.dataset.live = live ? "1" : "";
  el.title = new Date(node.createdAt).toLocaleString();
  if (editing.has(node.id) && !live) {
    fill(el, editor(app, node));
    el.dataset.editing = "1";
    return;
  }
  el.dataset.editing = "";
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
        node.files?.length
          ? h(
              "div.lm-msg-files",
              null,
              node.files.map((f) =>
                h("span.lm-file-chip", { title: f.path ?? f.name }, icon("file"), f.name),
              ),
            )
          : null,
        node.content ? h("div.lm-bubble", null, node.content) : null,
        node.sources?.length ? sourcesBlock(node) : null,
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
  let cache = drawn.get(node.id);
  if (!cache) {
    cache = { keys: [], els: [] };
    drawn.set(node.id, cache);
  }
  if (split.content)
    renderMarkdown(body, node.format ? jsonBlock(split.content, live) : split.content, {
      live,
      cache,
      onLink: (url) => void app.openLink(url),
    });
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
        live && o.speed
          ? h("span.lm-live-speed", null, icon("bolt"), `${o.speed.toFixed(1)} tok/s`)
          : null,
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
  const edit = iconButton(
    "edit",
    node.role === "user" ? "Edit" : "Edit the answer",
    () => {
      editing.set(node.id, node.content);
      app.S.touch("thread");
    },
    { disabled: busy },
  );
  const stopped = node.stats?.stopReason === "stopped" || node.stats?.stopReason === "length";
  const more = iconButton("more", "More", (e) =>
    openMenu(e, [
      { label: "New chat from here", icon: "newChat", run: () => branchToNew(app, node.id) },
      { label: "Copy as Markdown", icon: "copy", run: () => void copyText(node.content) },
      { separator: true },
      {
        label: "Remove this and what follows",
        icon: "trash",
        danger: true,
        disabled: busy || live,
        run: () => app.deleteNode(node.id),
      },
    ]),
  );
  const shift = (/** @type {number} */ delta) => {
    switchBranch(thread, node.id, delta);
    app.S.touch("thread");
    app.persist(thread);
  };
  const stats = node.role === "assistant" ? statsLine(node) : [];
  return h(
    "div.lm-msg-foot",
    { dataset: { role: node.role } },
    count > 1
      ? h(
          "div.lm-branch",
          { "aria-label": `Version ${index} of ${count}` },
          iconButton("chevronLeft", "Previous version", () => shift(-1), {
            disabled: index <= 1 || busy,
          }),
          h("span.lm-branch-count", null, `${index} / ${count}`),
          iconButton("chevronRight", "Next version", () => shift(1), {
            disabled: index >= count || busy,
          }),
        )
      : null,
    h(
      "div.lm-msg-actions",
      null,
      copy,
      edit,
      node.role === "assistant"
        ? iconButton("refresh", "Ask again", () => void app.regenerate(node.id), { disabled: busy })
        : null,
      more,
    ),
    stopped && node.role === "assistant"
      ? h(
          "button.desk-btn.desk-btn-quiet.lm-continue",
          { type: "button", disabled: busy, onClick: () => void continueAnswer(app, node.id) },
          icon("play"),
          "Continue",
        )
      : null,
    stats.length
      ? h(
          "div.lm-stats",
          null,
          stats.map((s) => h("span", null, s)),
        )
      : null,
  );
}

/** Start editing the last question (↑ in an empty composer). @param {App} app */
export function editLastQuestion(app) {
  const thread = app.S.get().thread;
  if (!thread || app.S.get().generating) return false;
  const last = path(thread).findLast((n) => n.role === "user");
  if (!last) return false;
  editing.set(last.id, last.content);
  app.S.touch("thread");
  return true;
}
