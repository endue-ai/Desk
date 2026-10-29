// The first run's director: one timeline on the page clock, Eris's lines as soul text and in her
// voice, the person's words rising into the orb, one question at a time, and progress kept in the
// core store so an interrupted first run picks up where it stopped. The scenes are separate modules;
// script times decide when things happen, answers only choose branches.
import { leave, REDUCED, renderLine, WISP, wordsFromText } from "eris/soul-text.js";
import { Timeline } from "eris/timeline.js";
import { createVoice } from "eris/voice.js";
import { nextScene, RESUMABLE, RESUME_AT } from "./flow.js";
import { SAY, TIMES } from "./script.js";
import { createSound } from "./sound.js";

export const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const style = reduced ? REDUCED : WISP;
export const $ = (id) => document.getElementById(id);
export const FIRST_RUN = "first-run";
export const LAYOUTS = "layouts";
export const ASSETS = "../../endue.eris/ui/assets";
export const EASE = "cubic-bezier(.2,.7,.2,1)";
/** Without voice timestamps a line's words spread at about speaking speed. */
const MS_PER_CHAR = 55;

/** An element's centre in #root's coordinates, from layout offsets (transforms do not move it). */
export function centre(el) {
  let x = el.offsetWidth / 2;
  let y = el.offsetHeight / 2;
  for (let node = el; node && node.id !== "root"; node = node.offsetParent) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class Director {
  constructor(ctx, scenes) {
    this.ctx = ctx;
    this.scenes = scenes;
    this.timeline = new Timeline();
    this.voice = createVoice(window);
    this.sound = createSound(window);
    this.next = 10; // line index: seeds each line's scatter
    this.state = {
      name: null,
      listening: false,
      micAsked: false,
      connections: [],
      skipped: false,
      region: true,
    };
    this.current = null;
    this.orb = undefined;
    this.stagePose = "none";
    this.nudged = false; // "Still there?" is said once per first run
    this.waiting = 0; // the question that waits for an answer
  }

  scene(name) {
    document.documentElement.dataset.scene = name;
  }

  /** Start scene `name` at `at`: it shows and is remembered from then, and schedules its own cues. */
  go(name, at = this.timeline.time) {
    this.current = name;
    this.timeline.at(at, () => {
      this.scene(name);
      if (RESUMABLE.includes(name)) {
        const scene = RESUME_AT[name] ?? name;
        void this.store(FIRST_RUN, { done: false, scene, ...this.state });
      }
    });
    this.scenes[name](this, at);
  }

  /** On to the scene after the current one (flow.js decides which). */
  advance(at) {
    const next = nextScene(this.current, this.state);
    if (next) this.go(next, at);
  }

  async store(key, value) {
    try {
      await this.ctx.bridge.call("store.set", { key, value });
    } catch {
      // A first run that cannot be saved still runs; it starts over next time.
    }
  }

  async load(key) {
    try {
      return (await this.ctx.bridge.call("store.get", { key })).value;
    } catch {
      return undefined;
    }
  }

  /**
   * Say a sentence from `at`: soul text in `into` (under the orb by default), the whole sentence in the
   * live region, and aloud. The line is built when it starts and removed once it has scattered.
   * Returns a handle for `drop`; `handle.out` is when the line starts to scatter (null: it stays).
   */
  say(text, at, options = {}) {
    const {
      words,
      stay = false,
      out,
      into = $("cap"),
      speak = true,
      announce = true,
      who,
    } = options;
    const spoken = words ?? wordsFromText(text, at, Math.max(400, text.length * MS_PER_CHAR));
    const last = spoken[spoken.length - 1]?.at ?? at;
    const hold = 1000 + Math.min(400, text.length * 10);
    const line = { index: this.next++, words: spoken, out: stay ? null : (out ?? last + hold) };
    const handle = { element: null, out: line.out };
    this.timeline.at(at, () => {
      handle.element = renderLine(document, this.timeline, line, style);
      into.append(handle.element);
      if (announce) this.announce(who ? `${who}: ${text}` : text);
      if (speak) this.voice.speak(text);
    });
    if (line.out !== null) {
      const gone = line.out + style.jitterMs + style.outMs + 50;
      this.timeline.at(gone, () => handle.element?.remove());
    }
    return handle;
  }

  /** Let a staying line leave from `at`, then remove it. */
  drop(handle, at) {
    if (!handle) return;
    this.timeline.at(at, () => {
      if (handle.element) leave(this.timeline, handle.element, at, reduced);
    });
    this.timeline.at(at + 1150, () => handle.element?.remove());
  }

  announce(text) {
    const sentence = element("p", "", text);
    $("live").append(sentence);
  }

  /** The person's words rise from below into the orb's empty centre and light the core. */
  rise(text, at) {
    const rise = element("div", "user-rise", text.length > 40 ? `${text.slice(0, 37)}...` : text);
    rise.setAttribute("aria-hidden", "true");
    $("stage").append(rise);
    const frames = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { offset: 0, opacity: 0, transform: "translateY(388px)" },
          { offset: 0.12, opacity: 1, transform: "translateY(376px)" },
          {
            offset: 0.7,
            opacity: 0.9,
            filter: "blur(0px)",
            transform: "translateY(40px) scale(0.7)",
          },
          { offset: 1, opacity: 0, filter: "blur(6px)", transform: "translateY(0px) scale(0.3)" },
        ];
    this.timeline.add(
      rise.animate(frames, {
        delay: at,
        duration: reduced ? 300 : 1400,
        easing: "cubic-bezier(.4,0,.2,1)",
        fill: "both",
      }),
    );
    this.orb.flash(at + 1250);
    this.timeline.at(at + 1500, () => rise.remove());
  }

  /** Animate `el` from `at` on the timeline and keep where it ends. */
  move(el, frames, at, duration, easing = EASE) {
    return this.timeline.add(
      el.animate(frames, {
        delay: at,
        duration: reduced ? Math.min(duration, 200) : duration,
        easing,
        fill: "forwards",
      }),
    );
  }

  /** Where Eris stands: "centre"; "up", smaller, while the browser signs in; "aside", top left. */
  pose(name, at) {
    const stage = $("stage");
    let to = "none";
    if (name === "up") to = "translateY(-96px) scale(0.8)";
    if (name === "aside") {
      const dx = 344 - (stage.offsetLeft + stage.offsetWidth / 2);
      to = `translate(${dx}px, ${56 - stage.offsetTop}px) scale(0.5)`;
    }
    this.move(stage, [{ transform: this.stagePose }, { transform: to }], at, 900);
    this.stagePose = to;
  }

  /**
   * Put an input under Eris's `question` and call `answer(value)` on Enter. While the microphone
   * listens the input comes 1.6 s later with a hint, and 8 s of silence bring "Still there?" once
   * per first run. Returns the question's token.
   */
  ask(at, { question, label, placeholder, autocomplete = "off", answer }) {
    const token = ++this.waiting;
    const formAt = this.state.listening ? at + TIMES.formDelay : at;
    this.timeline.at(formAt, () => {
      if (this.waiting !== token) return;
      const form = element("form", "ask-form");
      const field = element("div");
      const id = `ask-${token}`;
      const tag = element("label", "", label);
      tag.htmlFor = id;
      const input = element("input");
      Object.assign(input, { id, type: "text", autocomplete, maxLength: 80, placeholder });
      field.append(tag, input);
      form.append(
        field,
        Object.assign(element("button", "btn primary", "Send"), { type: "submit" }),
      );
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        answer(input.value);
      });
      $("formslot").replaceChildren(form);
      if (this.state.listening) $("formslot").append(element("p", "", "Say it, or type it."));
      input.focus();
    });
    if (this.state.listening && !this.nudged) {
      this.timeline.at(at + TIMES.silence, () => {
        const input = $("formslot").querySelector("input");
        if (this.waiting !== token || this.nudged || input?.value) return;
        this.nudged = true;
        const now = this.timeline.time;
        this.drop(question, now);
        this.say(SAY.still, now + 300);
        input?.focus();
      });
    }
    return token;
  }

  /** Stop waiting for the current question and take its input away. */
  answered() {
    this.waiting += 1;
    $("formslot").replaceChildren();
  }

  /** Buttons along the bottom edge (choices never sit in the centre). Returns them. */
  edge(choices, className = "btn") {
    const buttons = choices.map(({ label, pick, pressed }) => {
      const button = element("button", className, label);
      button.type = "button";
      if (pressed !== undefined) button.setAttribute("aria-pressed", String(pressed));
      button.addEventListener("click", () => pick(button));
      return button;
    });
    $("edge").replaceChildren(...buttons);
    return buttons;
  }

  /**
   * Run `fn(at, waited)` once endue can be reached: now (`waited` false), or after saying it cannot
   * and the connection is back (`waited` true), so the scene picks up where it was.
   */
  whenOnline(at, fn) {
    if (navigator.onLine) return fn(at, false);
    const line = this.say(SAY.offline, at, { stay: true });
    window.addEventListener(
      "online",
      () => {
        const now = this.timeline.time;
        this.drop(line, now);
        fn(now + 1200, true);
      },
      { once: true },
    );
  }

  finish() {
    const root = $("root");
    const fade = root.animate([{ opacity: 1 }, { opacity: 0 }], {
      delay: this.timeline.time,
      duration: reduced ? 200 : 600,
      fill: "forwards",
    });
    this.timeline.add(fade);
    this.timeline.at(this.timeline.time + 700, () => this.ctx.surface.close());
  }
}
