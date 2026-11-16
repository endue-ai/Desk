// The assistant: a panel at the right that every AI action answers in, one entry per question,
// and where the person asks their own about this engine (with suggestions for what is on screen).
// Each entry shows what was asked, then the answer as a card, or why there is none.

import { createAsker } from "./ai-ask.js";
import { answerCard, diagnosisCard, filesCard, fixesCard, logsCard } from "./ai-cards.js";
import * as P from "./ai-prompts.js";
import { button, h, icon } from "./dom.js";
import { historyArgs, parseHistory } from "./images.js";
import { imageName, problemOf } from "./model.js";
import { objectRef } from "./refs.js";

/** @typedef {import("./studio.js").App} App */

/** @param {App} app */
export function createAssistant(app) {
  const asker = createAsker(app.ctx.bridge);
  const thread = h("div.ai-thread", { role: "log", "aria-label": "Answers" });
  const chips = h("div.ai-chips");
  const box = /** @type {HTMLTextAreaElement} */ (
    h("textarea.desk-field.ai-input", {
      rows: "2",
      placeholder: "Ask about your containers, images, stacks…",
      "aria-label": "Question",
    })
  );
  const panel = h(
    "aside.ai-panel",
    { "aria-label": "Ask AI", hidden: true },
    h(
      "header.ai-head",
      null,
      h("span.ai-mark", null, icon("sparkle", 16)),
      h(
        "div",
        null,
        h("b", null, "Ask AI"),
        h("small", null, "Answers from this engine's facts; you run what it suggests"),
      ),
      h("span.grow"),
      button({
        label: "Clear",
        icon: "trash",
        hideLabel: true,
        onClick: () => thread.replaceChildren(empty()),
      }),
      button({ label: "Close", icon: "x", hideLabel: true, onClick: () => close() }),
    ),
    thread,
    h(
      "form.ai-compose",
      {
        onSubmit: (/** @type {Event} */ e) => {
          e.preventDefault();
          send();
        },
      },
      chips,
      h(
        "div.ai-input-row",
        null,
        box,
        button({
          label: "Send",
          icon: "send",
          hideLabel: true,
          kind: "desk-btn-primary",
          attrs: { type: "submit" },
        }),
      ),
    ),
  );
  document.body.append(panel);

  const empty = () =>
    h(
      "div.ai-empty",
      null,
      h("span.ai-mark.big", null, icon("sparkle", 22)),
      h("b", null, "What do you want to know?"),
      h(
        "p",
        null,
        "Ask why something failed, what uses your disk, or how to run something. Answers come from what this engine says; commands run only when you say so.",
      ),
    );
  thread.append(empty());

  const close = () => {
    panel.hidden = true;
    document.body.classList.remove("ai-open");
  };
  /** Show the panel; with a question, ask it at once. */
  const open = (question = "") => {
    panel.hidden = false;
    document.body.classList.add("ai-open");
    drawChips();
    box.focus();
    if (question) {
      box.value = question;
      send();
    }
  };
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    } else if (e.key === "Escape") close();
  });

  /** What the page on screen is about, for the question and the suggestions. */
  const focus = () => {
    const d = app.store.state.detail;
    if (!d) return "";
    if (d.kind === "container") {
      const c = app.store.state.containers.find((x) => x.id === d.id);
      return c ? P.containerFacts(c) : "";
    }
    return `${d.kind} ${d.id}`;
  };

  const drawChips = () => {
    const troubled = app.store.state.containers.find((c) => problemOf(c));
    const ideas = [
      troubled ? `Why did ${troubled.name} fail?` : "Is anything unhealthy?",
      "What uses the most memory?",
      "How do I free disk space?",
      "Which ports are published?",
    ];
    chips.replaceChildren(
      ...ideas.map((q) =>
        h(
          "button.desk-btn.desk-btn-quiet.chip",
          {
            type: "button",
            onClick: () => {
              box.value = q;
              send();
            },
          },
          q,
        ),
      ),
    );
  };

  /**
   * One entry: what was asked, then the answer drawn by `draw`, or why there is none.
   * @param {string} title @param {string} asked @param {() => Promise<any>} job @param {(a: any) => HTMLElement} draw
   */
  const entry = async (title, asked, job, draw) => {
    open();
    thread.querySelector(".ai-empty")?.remove();
    const body = h("div.ai-body", null, h("div.ai-thinking", null, h("span.spinner"), "Thinking…"));
    const el = h(
      "article.ai-entry",
      null,
      h("div.ai-asked", null, h("small", null, title), asked ? h("p", null, asked) : null),
      body,
    );
    thread.append(el);
    el.scrollIntoView({ block: "end" });
    try {
      const answer = await job();
      body.replaceChildren(
        answer
          ? draw(answer)
          : h("p.muted", null, "The brain answered in words, not in the form asked; try again."),
      );
    } catch (error) {
      body.replaceChildren(
        h(
          "p.ai-error",
          null,
          icon("alert", 14),
          String(/** @type {any} */ (error)?.message ?? error),
        ),
      );
    }
    el.scrollIntoView({ block: "nearest" });
  };

  const send = () => {
    const q = box.value.trim();
    if (!q) return;
    box.value = "";
    void entry(
      "You asked",
      q,
      () => asker.ask(P.answerPrompt(q, app.store.state, focus()), P.TOOLS.answer),
      (a) => answerCard(app, a),
    );
  };

  return {
    open,
    close,
    toggle: () => (panel.hidden ? open() : close()),
    /** Why a container is in trouble, from its state and its last lines. @param {string} id */
    diagnose(id) {
      const c = app.store.state.containers.find((x) => x.id === id || x.name === id);
      if (!c) return;
      void entry(
        `Diagnosis · ${c.name}`,
        problemOf(c)?.text ?? "",
        async () => {
          const { stdout, stderr } = await app.docker(
            ["logs", "--tail", "150", "--timestamps", "--", objectRef(c.id)],
            { timeoutMs: 20_000 },
          );
          const lines = `${stdout}\n${stderr}`.split("\n").filter(Boolean).sort();
          return asker.ask(P.diagnosePrompt(c, lines), P.TOOLS.diagnose);
        },
        (a) => diagnosisCard(app, a),
      );
    },
    /** @param {string} name @param {Array<{ text: string, source?: string }>} lines */
    explainLogs(name, lines) {
      const text = lines.map((l) => `${l.source ? `${l.source} | ` : ""}${l.text}`);
      void entry(
        `Logs · ${name}`,
        `Explain the last ${text.length} lines`,
        () => asker.ask(P.logsPrompt(name, text), P.TOOLS.logs),
        (a) => logsCard(app, a),
      );
    },
    /** @param {import("./parse.js").Image} image @param {import("./images.js").Layer[]} layers */
    optimizeImage(image, layers) {
      void entry(
        `Image · ${imageName(image)}`,
        "How to make it smaller",
        async () => {
          const list = layers.length
            ? layers
            : parseHistory((await app.docker(historyArgs(image.refs[0] ?? image.id))).stdout);
          return asker.ask(P.optimizePrompt(image, list), P.TOOLS.optimize);
        },
        (a) => fixesCard(app, a),
      );
    },
    /** @param {any} record @param {any} model */
    explainBuild(record, model) {
      void entry(
        `Build · ${record.tag}`,
        "Why did it fail?",
        () => asker.ask(P.buildPrompt(record, model?.steps ?? record.steps), P.TOOLS.build),
        (a) => fixesCard(app, a),
      );
    },
    /** Tailor the writer's files to the project as the person describes it. @param {any} _o @param {Array<[string, string]>} files @param {(files: Array<[string, string]>) => void} use */
    tailorScaffold(_o, files, use) {
      open();
      thread.querySelector(".ai-empty")?.remove();
      const about = /** @type {HTMLTextAreaElement} */ (
        h("textarea.desk-field.ai-input", {
          rows: "3",
          placeholder: "A Next.js app with Prisma and a background worker…",
          "aria-label": "The project",
        })
      );
      const form = h(
        "article.ai-entry",
        null,
        h(
          "div.ai-asked",
          null,
          h("small", null, "Tailor the Docker files"),
          h("p", null, "What is the project? Its framework, how it starts, what it needs."),
        ),
        about,
        button({
          label: "Tailor",
          icon: "sparkle",
          kind: "desk-btn-primary",
          onClick: () => {
            const d = about.value.trim();
            if (!d) return;
            form.remove();
            void entry(
              "Tailor the Docker files",
              d,
              () => asker.ask(P.tailorPrompt(d, files), P.TOOLS.tailor),
              (a) => filesCard(app, a, use),
            );
          },
        }),
      );
      thread.append(form);
      about.focus();
    },
  };
}
