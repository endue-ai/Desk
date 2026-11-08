// Talking to Eris: what the person types rises into her centre and is absorbed, and the brain's
// answer comes back as soul text under her, word by word while it streams (brain.say, brain.turn).

import { createContext } from "./context.js";
import { createConversation } from "./conversation.js";
import { leave, renderLine, wordsFromText } from "./soul-text.js";

const CONVERSE = { permission: "brain:converse" };
/** The smallest gap between two words appearing, when deltas arrive faster than that. */
const WORD_GAP = 90;
const FAILED = "Something went wrong on my side. Try that again in a moment.";

/** The words of `text` that are complete: all of them once the answer is final. */
export function completeWords(text, final) {
  const words = text.split(/\s+/).filter(Boolean);
  return final || /\s$/.test(text) ? words : words.slice(0, -1);
}

export class Talk {
  #doc;
  #bridge;
  #timeline;
  #show;
  #style;
  #reduced;
  #turn = null;
  #busy = false;
  #line = null;
  #notice = null;
  #text = "";
  #shown = 0;
  #nextAt = 0;
  #index = 100;
  #completed;
  #conversation;
  #context;
  #question = "";

  /** `show(pose)` switches Eris's pose; `style` is the soul text style. */
  constructor({
    doc,
    bridge,
    timeline,
    show,
    style,
    reduced,
    commands,
    state,
    completed = () => {},
  }) {
    this.#completed = completed;
    this.#doc = doc;
    this.#bridge = bridge;
    this.#timeline = timeline;
    this.#show = show;
    this.#style = style;
    this.#reduced = reduced;
    this.#conversation = createConversation(doc, state);
    this.#context = createContext(doc, bridge, commands);
  }

  start() {
    this.#el("say").addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send(this.#el("say-text").value);
    });
    this.#bridge.onEvent((event) => this.#onEvent(event));
  }

  async send(value) {
    const text = value.trim();
    if (!text || this.#busy) return;
    let message;
    try {
      message = this.#context.message(text);
    } catch (error) {
      this.#context.report(error.message);
      return;
    }
    this.#question = text;
    this.#conversation.begin(text, this.#context.name());
    this.#setBusy(true);
    this.#turn = null;
    this.#el("say-text").value = "";
    this.#rise(text);
    this.#show("thinking");
    try {
      const { turnId } = await this.#bridge.call("brain.say", { text: message, scope: CONVERSE });
      this.#turn ??= turnId;
      this.#context.clear();
    } catch {
      this.#fail(FAILED);
    }
  }

  showExchange(prompt, answer) {
    if (this.#busy) throw new Error("Wait for Eris to finish before opening another exchange.");
    this.#el("say-text").value = prompt;
    this.#conversation.begin(prompt);
    this.#conversation.answer(answer, true);
    this.#begin();
    this.#text = answer;
    this.#write(true);
    this.#announce(answer);
    this.#show("idle");
  }

  #onEvent(event) {
    if (event.event !== "brain.turn" || !this.#busy) return;
    const { turnId, kind, text } = event.data;
    // Desk sends a plugin only its own turns, so an event before the answer is for this one.
    if (this.#turn === null && this.#busy) this.#turn = turnId;
    if (turnId !== this.#turn) return;
    switch (kind) {
      case "started":
        this.#show("thinking");
        this.#begin();
        break;
      case "delta":
        if (!this.#line) this.#begin();
        this.#text += text ?? "";
        this.#write(false);
        this.#conversation.answer(this.#text);
        break;
      case "completed":
        this.#completed({ id: turnId, prompt: this.#question, answer: this.#text });
        this.#write(true);
        this.#announce(this.#text.trim());
        this.#conversation.answer(this.#text, true);
        this.#show("done");
        this.#setBusy(false);
        this.#timeline.at(this.#timeline.time + 1200, () => {
          if (!this.#busy) this.#show("idle");
        });
        break;
      case "offline":
        this.#show("heads-up");
        this.#notice = this.#say(text ?? "");
        this.#conversation.notice(text ?? "Waiting for connection…");
        break;
      case "online":
        this.#drop(this.#notice);
        this.#notice = null;
        this.#show("thinking");
        break;
      case "error":
        this.#fail(text ?? FAILED);
        break;
    }
  }

  /** A new answer line; the previous answer and any notice leave. */
  #begin() {
    this.#drop(this.#line);
    this.#drop(this.#notice);
    this.#notice = null;
    this.#index += 1;
    this.#line = renderLine(
      this.#doc,
      this.#timeline,
      { index: this.#index, words: [], out: null },
      this.#style,
    );
    this.#el("answer").append(this.#line);
    this.#text = "";
    this.#shown = 0;
    this.#nextAt = this.#timeline.time;
  }

  /** Put the words that are complete so far on screen, each condensing as it arrives. */
  #write(final) {
    const fresh = completeWords(this.#text, final).slice(this.#shown);
    if (fresh.length === 0) return;
    let at = Math.max(this.#timeline.time, this.#nextAt);
    const words = fresh.map((t) => {
      const word = { t, at };
      at += WORD_GAP;
      return word;
    });
    this.#nextAt = at;
    const piece = renderLine(
      this.#doc,
      this.#timeline,
      { index: this.#index, words, out: null },
      this.#style,
    );
    const row = this.#line.querySelector(".line");
    for (const word of [...piece.querySelectorAll(".word")]) row.append(word);
    this.#shown += fresh.length;
  }

  /** A sentence of Eris's own (offline, read-only, failure) that stays until the next answer. */
  #say(text) {
    const now = this.#timeline.time;
    const words = wordsFromText(text, now, Math.min(1600, Math.max(400, text.length * 45)));
    this.#index += 1;
    const line = renderLine(
      this.#doc,
      this.#timeline,
      { index: this.#index, words, out: null },
      this.#style,
    );
    this.#el("answer").append(line);
    this.#announce(text);
    return line;
  }

  #fail(text) {
    this.#conversation.notice(text, true);
    if (!this.#el("say-text").value) this.#el("say-text").value = this.#question;
    this.#drop(this.#line);
    this.#drop(this.#notice);
    this.#line = null;
    this.#notice = this.#say(text);
    this.#show("oops");
    this.#setBusy(false);
  }

  #drop(element) {
    if (!element) return;
    const now = this.#timeline.time;
    leave(this.#timeline, element, now, this.#reduced);
    this.#timeline.at(now + 1150, () => element.remove());
  }

  /** The words rise from the input into Eris's centre and are absorbed there. */
  #rise(text) {
    const pose = this.#el("pose").getBoundingClientRect();
    const input = this.#el("say-text").getBoundingClientRect();
    const centre = pose.top + pose.height / 2;
    const rise = this.#doc.createElement("div");
    rise.className = "user-rise";
    rise.setAttribute("aria-hidden", "true");
    rise.textContent = text.length > 60 ? `${text.slice(0, 57)}...` : text;
    rise.style.top = `${centre}px`;
    this.#el("root").append(rise);
    const from = Math.max(0, input.top - centre);
    const frames = this.#reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { offset: 0, opacity: 0, transform: `translate(-50%, ${from}px)` },
          { offset: 0.12, opacity: 1, transform: `translate(-50%, ${from * 0.95}px)` },
          {
            offset: 0.7,
            opacity: 0.9,
            filter: "blur(0px)",
            transform: "translate(-50%, 8px) scale(0.7)",
          },
          {
            offset: 1,
            opacity: 0,
            filter: "blur(6px)",
            transform: "translate(-50%, -50%) scale(0.3)",
          },
        ];
    const now = this.#timeline.time;
    this.#timeline.add(
      rise.animate(frames, {
        delay: now,
        duration: this.#reduced ? 300 : 1400,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "both",
      }),
    );
    this.#timeline.at(now + 1500, () => rise.remove());
  }

  #announce(text) {
    if (!text) return;
    const live = this.#el("live");
    const sentence = this.#doc.createElement("p");
    sentence.textContent = text;
    live.append(sentence);
    while (live.childElementCount > 10) live.firstElementChild.remove();
  }

  #setBusy(busy) {
    this.#busy = busy;
    for (const button of this.#el("say").querySelectorAll("button")) button.disabled = busy;
  }

  #el(id) {
    return this.#doc.getElementById(id);
  }
}
