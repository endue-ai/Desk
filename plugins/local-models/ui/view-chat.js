// The chat section: the thread list, the conversation with its header (the model in use, the
// title), the composer under it. While an answer streams only its message redraws, and the view
// follows it down unless the person scrolled up to read.
import { fill, h, icon, iconButton } from "./dom.js";
import { drawMessage, messageEl } from "./message.js";
import { path } from "./threads.js";
import { composerView } from "./view-composer.js";
import { modelLabel } from "./view-picker.js";
import { threadsView } from "./view-threads.js";

/** @typedef {import("./app.js").App} App */

const SUGGESTIONS = [
  {
    icon: "lightbulb",
    title: "Explain a concept",
    prompt: "Explain how a transformer language model works, in plain words, with a small example.",
  },
  {
    icon: "code",
    title: "Write some code",
    prompt:
      "Write a Python function that removes duplicate lines from a file while keeping their order, with tests.",
  },
  {
    icon: "pen",
    title: "Help me write",
    prompt: "Draft a short, friendly email asking a colleague to review my pull request this week.",
  },
  {
    icon: "book",
    title: "Summarize",
    prompt: "Summarize the key ideas of the Unix philosophy in five bullet points.",
  },
];

/** @param {App} app */
export function chatView(app) {
  const { S } = app;
  const threads = threadsView(app);
  const conv = h("div.lm-conv");
  const scroller = h("div.lm-scroll", null, conv);
  const composer = composerView(app);
  const pickerButton = h("button.desk-btn.desk-btn-quiet.lm-model-pill", {
    type: "button",
    "aria-haspopup": "dialog",
    onClick: () => S.set({ picker: true }),
  });
  const title = h("div.lm-title");
  const header = h(
    "header.lm-head",
    null,
    iconButton("panelLeft", "Show or hide the chats (Mod+B)", () => {
      S.set({ sidebar: !S.get().sidebar });
      app.savePrefs();
    }),
    pickerButton,
    title,
    h("div.lm-head-spacer"),
    iconButton("newChat", "New chat", () => app.newChat(), { class: "lm-head-new" }),
  );
  const main = h("main.lm-main", null, header, scroller, composer.el);
  const el = h("section.lm-chat", null, threads.el, main);

  let follow = true;
  scroller.addEventListener("scroll", () => {
    follow = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  });
  const toBottom = () => {
    if (follow) scroller.scrollTop = scroller.scrollHeight;
  };

  function drawHeader() {
    const { thread, selected, models, servers } = S.get();
    const key = thread?.model ?? selected;
    const model = models.find((m) => `${m.serverId}|${m.id}` === key);
    const server = servers.find((s) => key?.startsWith(`${s.id}|`));
    fill(
      pickerButton,
      h("span.lm-pill-dot", {
        dataset: { state: model ? (model.loaded ? "loaded" : "ready") : "none" },
      }),
      h("span.lm-pill-name", null, model ? model.name : key ? modelLabel(key) : "Choose a model"),
      model?.quant || model?.params
        ? h(
            "span.lm-pill-meta",
            null,
            [model.name.includes(model.params ?? "\u0000") ? "" : model.params, model.quant]
              .filter(Boolean)
              .join(" · "),
          )
        : null,
      server && !model ? h("span.lm-pill-meta", null, "not found") : null,
      icon("chevronDown", "lm-caret"),
    );
    pickerButton.title = model
      ? `${model.id} on ${server?.label ?? "?"} (Mod+L)`
      : "Choose a model (Mod+L)";
    fill(title, thread && Object.keys(thread.nodes).length ? thread.title : "");
    el.dataset.sidebar = S.get().sidebar ? "1" : "0";
  }

  function emptyState() {
    const { models, servers, scanning, ready } = S.get();
    const online = servers.filter((s) => s.status === "online");
    const chatModels = models.filter((m) => !m.caps.includes("embedding"));
    if (ready && !online.length && !scanning)
      return h(
        "div.lm-empty",
        null,
        h("div.lm-empty-mark", null, icon("server")),
        h("h1.lm-empty-title", null, "No model server is running"),
        h(
          "p.lm-empty-text",
          null,
          "Start Ollama, llama.cpp's server or any OpenAI-compatible server on this computer, and its models show here. Nothing is sent anywhere else.",
        ),
        h(
          "div.lm-empty-actions",
          null,
          h(
            "button.desk-btn.desk-btn-primary",
            { type: "button", onClick: () => void app.scan() },
            icon("refresh"),
            "Look again",
          ),
          h(
            "button.desk-btn",
            { type: "button", onClick: () => S.set({ view: "models" }) },
            icon("server"),
            "Add a server",
          ),
        ),
      );
    const key = S.get().thread?.model ?? S.get().selected;
    const model = models.find((m) => `${m.serverId}|${m.id}` === key);
    const server = servers.find((s) => key?.startsWith(`${s.id}|`));
    return h(
      "div.lm-empty",
      null,
      h("div.lm-empty-mark", null, icon("sparkle")),
      h("h1.lm-empty-title", null, "What can I help with?"),
      h(
        "p.lm-empty-text",
        null,
        model
          ? [
              h("strong", null, model.name),
              ` on ${server?.label ?? "a local server"}. Everything stays on this computer.`,
            ]
          : chatModels.length
            ? "Choose a model to start."
            : scanning
              ? "Looking for model servers…"
              : "The servers answering have no chat models yet.",
      ),
      h(
        "div.lm-suggest",
        null,
        SUGGESTIONS.map((s) =>
          h(
            "button.desk-btn.lm-suggest-card",
            {
              type: "button",
              disabled: !model,
              onClick: () => void app.send(s.prompt),
            },
            icon(/** @type {any} */ (s.icon)),
            h("span.lm-suggest-title", null, s.title),
            h("span.lm-suggest-text", null, s.prompt),
          ),
        ),
      ),
    );
  }

  /** @type {Map<string, HTMLElement>} */
  let shown = new Map();

  function drawConversation() {
    const { thread, generating } = S.get();
    const nodes = thread ? path(thread).filter((n) => n.role !== "tool") : [];
    if (!thread || !nodes.length) {
      shown = new Map();
      fill(conv, emptyState());
      conv.dataset.empty = "1";
      return;
    }
    conv.dataset.empty = "";
    /** @type {Map<string, HTMLElement>} */
    const next = new Map();
    const els = nodes.map((node) => {
      const live = generating?.nodeId === node.id;
      const old = shown.get(node.id);
      if (old) {
        drawMessage(app, thread, node, old, { live });
        next.set(node.id, old);
        return old;
      }
      const made = messageEl(app, thread, node, { live });
      next.set(node.id, made);
      return made;
    });
    shown = next;
    conv.replaceChildren(...els);
    requestAnimationFrame(toBottom);
  }

  S.onSignal("stream", (/** @type {import("./threads.js").Node} */ node) => {
    const thread = S.get().thread;
    const el2 = shown.get(node.id);
    if (!thread || !el2) return;
    drawMessage(app, thread, node, el2, { live: true });
    toBottom();
  });

  S.on(["thread", "selected", "models", "servers", "sidebar"], drawHeader);
  S.on(["thread", "generating", "models", "servers", "scanning", "ready"], (_s, changed) => {
    if (changed.has("thread")) follow = true;
    drawConversation();
  });
  drawHeader();
  drawConversation();

  el.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "l") {
      e.preventDefault();
      S.set({ picker: true });
    } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
      e.preventDefault();
      app.newChat();
      composer.focus();
    } else if (mod && e.key.toLowerCase() === "b") {
      e.preventDefault();
      S.set({ sidebar: !S.get().sidebar });
      app.savePrefs();
    } else if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      threads.focusSearch();
    }
  });
  return { el, focus: () => composer.focus() };
}
