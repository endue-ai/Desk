// Talking and typing to Eris on the island (ADR 0204): the desk's one conversation (ADR 0027), as the
// floating Eris keeps it (ADR 0121) and without her figure. A line goes to `brain.say` as the desk
// (the shell pins the island's caller) and her answer follows its `brain.turn` events; both go to
// the desk through the app's storage, which it shares with the island, so the desk's Eris says it
// too, and what the desk hears comes back here. Option+Enter focuses the field from any app.
import {
  askEris,
  type ErisLine,
  type FloatCore,
  type FloatLang,
  floatSide,
  floatText,
  keepLines,
  type LinkChannel,
  statusOf,
  statusText,
  watchBrain,
} from "@endue-ai/runtime";
import "./island-talk.css";

export interface TalkHost {
  core: FloatCore;
  channel: LinkChannel;
  lang: FloatLang;
  /** The shortcut that brings the talk from any app and how it reads; undefined while none. */
  shortcut(): { label: string } | undefined;
  /** What the talk shows changed: the island draws and fits again. */
  changed(): void;
}

export interface IslandTalk {
  el: HTMLElement;
  /** Put the keys in the field (Option+Enter). */
  focus(): void;
  /** A composition (Korean, Japanese) runs in the field: Escape ends it, not the talk. */
  composing(): boolean;
  /** A line of the person's waits for her answer. */
  asking(): boolean;
  /** Draw again (the shortcut's label came). */
  refresh(): void;
  dispose(): void;
}

/** How many lines of the conversation the island shows. */
const SHOWN = 4;

export function mountTalk(doc: Document, host: TalkHost): IslandTalk {
  const tr = (key: Parameters<typeof floatText>[1], vars?: Record<string, string>) =>
    floatText(host.lang, key, vars);
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = "") => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const link = floatSide(host.channel);
  let snapshot = link.snapshot();
  let lines: ErisLine[] = snapshot?.lines ?? [];
  let asking = false;
  let composing = false;
  let failure = "";

  const box = el("section", "island-talk");
  box.setAttribute("aria-label", tr("talk"));
  const head = el("div", "island-talk-head");
  const title = el("h2", "island-heading", tr("figure"));
  const status = el("p", "island-talk-status");
  status.setAttribute("role", "status");
  head.append(title, status);
  const list = el("ol", "island-talk-lines");
  list.setAttribute("aria-label", tr("conversation"));
  const empty = el("p", "island-talk-empty");
  const error = el("p", "island-talk-error");
  error.setAttribute("role", "alert");
  const form = el("form", "island-talk-form");
  const input = el("input", "island-talk-input");
  input.type = "text";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = tr("placeholder");
  input.setAttribute("aria-label", tr("talk"));
  const send = el("button", "island-choice island-talk-send", tr("send"));
  send.type = "submit";
  form.append(input, send);
  box.append(head, list, empty, error, form);

  const brain = watchBrain(host.core, () => draw());

  const draw = () => {
    const shown = statusOf({
      state: snapshot?.state ?? "idle",
      talk: snapshot?.talk ?? "off",
      thinking: asking || brain.thinking(),
      speaking: false,
      approval: brain.approval(),
    });
    status.textContent = statusText(host.lang, shown);
    box.dataset.status = shown;
    send.disabled = asking;
    error.textContent = failure;
    error.hidden = !failure;
    const key = host.shortcut();
    empty.textContent = key ? `${tr("empty")} ${tr("hint", { key: key.label })}` : tr("empty");
    empty.hidden = lines.length > 0;
    list.replaceChildren(
      ...lines.slice(-SHOWN).map((line) => {
        const row = el("li", "island-talk-line");
        row.dataset.who = line.who;
        row.append(
          el("span", "island-who", tr(line.who)),
          el("span", "island-talk-text", line.text),
        );
        return row;
      }),
    );
    host.changed();
  };

  const ask = async () => {
    const text = input.value.trim();
    if (!text || asking) return;
    asking = true;
    failure = "";
    input.value = "";
    lines = keepLines(lines, { who: "you", text });
    link.back({ line: { who: "you", text }, state: "thinking" });
    draw();
    try {
      const answer = (await askEris(host.core, text)).trim();
      if (!answer) throw new Error("no answer");
      lines = keepLines(lines, { who: "eris", text: answer });
      link.back({ line: { who: "eris", text: answer }, state: "idle", said: answer });
    } catch {
      failure = tr("failed");
      // The question back in the field, to send again.
      if (!input.value) input.value = text;
      link.back({ state: "idle" });
    }
    asking = false;
    draw();
  };

  const offs: Array<() => void> = [
    link.onSnapshot((next) => {
      snapshot = next;
      lines = next.lines;
      draw();
    }),
  ];
  const on = (target: EventTarget, name: string, listener: (event: Event) => void) => {
    target.addEventListener(name, listener);
    offs.push(() => target.removeEventListener(name, listener));
  };
  on(input, "compositionstart", () => {
    composing = true;
  });
  on(input, "compositionend", () => {
    composing = false;
  });
  on(input, "keydown", (event) => {
    const key = event as KeyboardEvent;
    if (key.key !== "Enter" || key.isComposing || key.keyCode === 229) return;
    key.preventDefault();
    void ask();
  });
  on(form, "submit", (event) => {
    event.preventDefault();
    if (!composing) void ask();
  });
  draw();

  return {
    el: box,
    focus: () => input.focus(),
    composing: () => composing,
    asking: () => asking,
    refresh: () => draw(),
    dispose() {
      for (const off of offs.splice(0)) off();
      brain.dispose();
    },
  };
}
