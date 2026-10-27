// The first run, scenes 1-5 (docs/ko/first-run-scenario.md). Everything moves on one timeline driven
// by the page clock; bridge answers only choose branches, script times decide when things happen.
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { buildOrb } from "eris/orb.js";
import { leave, REDUCED, renderLine, WISP, wordsFromText } from "eris/soul-text.js";
import { Timeline } from "eris/timeline.js";
import { ASK, GREETING, NAME_AT, NICE, SAY, TIMES } from "./script.js";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const style = reduced ? REDUCED : WISP;
const $ = (id) => document.getElementById(id);
const FIRST_RUN = "first-run";

class Director {
  constructor(ctx) {
    this.ctx = ctx;
    this.timeline = new Timeline();
    this.next = 10; // line index: seeds each line's scatter
    this.name = undefined;
    this.listening = false;
    this.orb = undefined;
  }

  scene(name) {
    document.documentElement.dataset.scene = name;
  }

  /**
   * Say a sentence from `at`: soul text on screen, the whole sentence in the live region. The line
   * is built when it starts and removed once it has scattered, so only live lines are in the page.
   * Returns a handle for `drop`.
   */
  say(text, at, { words, stay = false, out } = {}) {
    const spoken =
      words ?? wordsFromText(text, at, Math.min(1600, Math.max(400, text.length * 45)));
    const last = spoken[spoken.length - 1]?.at ?? at;
    const hold = 1000 + Math.min(400, text.length * 10);
    const line = { index: this.next++, words: spoken, out: stay ? null : (out ?? last + hold) };
    const handle = { element: null };
    this.timeline.at(at, () => {
      handle.element = renderLine(document, this.timeline, line, style);
      $("cap").append(handle.element);
      const sentence = document.createElement("p");
      sentence.textContent = text;
      $("live").append(sentence);
    });
    if (line.out !== null) {
      const gone = line.out + style.jitterMs + style.outMs + 50;
      this.timeline.at(gone, () => handle.element?.remove());
    }
    return handle;
  }

  /** Let a staying line leave from `at`, then remove it. */
  drop(handle, at) {
    this.timeline.at(at, () => {
      if (handle.element) leave(this.timeline, handle.element, at, reduced);
    });
    this.timeline.at(at + 1150, () => handle.element?.remove());
  }

  firstRun() {
    this.scene("arrival");
    this.orb = buildOrb(document, this.timeline, $("sphere"), { assets: ASSETS, reduced });
    this.timeline.at(TIMES.skipVisible, () => this.showSkip());
    this.timeline.at(TIMES.greeting, () => this.scene("greeting"));
    for (const line of GREETING) {
      const text = line.words.map((w) => w.t).join(" ");
      this.say(text, line.words[0].cap ?? line.words[0].at, { words: line.words, out: line.out });
    }
    this.timeline.at(TIMES.talk, () => this.scene("microphone"));
    this.say(SAY.talk, TIMES.talk, { out: TIMES.microphone - 300 });
    const question = this.say(SAY.microphone, TIMES.microphone, { stay: true });
    this.timeline.at(TIMES.askMic, () => void this.askMicrophone(question));
  }

  async askMicrophone(question) {
    let granted = false;
    try {
      const answer = await this.ctx.bridge.call("perm.request", {
        permission: { permission: "audio:capture" },
        reason: "Eris listens when you talk to her. You can type instead.",
      });
      granted = answer.granted;
    } catch {
      granted = false;
    }
    const at = Math.max(this.timeline.time, TIMES.afterMic);
    this.drop(question, at);
    this.listening = granted;
    if (granted) this.orb.listen(at);
    this.say(granted ? SAY.listening : SAY.typing, at + 300, { out: at + 2300 });
    this.askName(at + 2600);
  }

  askName(at) {
    this.timeline.at(at, () => this.scene("name"));
    const words = ASK.map((word) => ({ t: word.t, at: at + word.at }));
    this.question = this.say(SAY.ask, at, { words, stay: true });
    // Typing is the only way in once the microphone was refused, so the input comes with the question.
    const formAt = this.listening ? at + TIMES.formDelay : at;
    this.timeline.at(formAt, () => this.showNameForm());
  }

  showNameForm() {
    const form = document.createElement("form");
    form.className = "name-form";
    form.innerHTML = `
      <div>
        <label for="eris-name">Type your name</label>
        <input id="eris-name" type="text" autocomplete="given-name" maxlength="24" placeholder="Your name" />
      </div>
      <button type="submit" class="btn primary">Send</button>`;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      this.submitName(form.querySelector("input").value);
    });
    $("formslot").replaceChildren(form);
    if (this.listening) {
      const hint = document.createElement("p");
      hint.textContent = "Say it, or type it.";
      $("formslot").append(hint);
    }
    form.querySelector("input").focus();
  }

  submitName(value) {
    const name = value.trim().slice(0, 24);
    const now = this.timeline.time;
    if (!name) {
      this.drop(this.question, now);
      this.question = this.say(SAY.again, now + 200, { stay: true });
      const input = $("formslot").querySelector("input");
      if (input) {
        input.value = "";
        input.focus();
      }
      return;
    }
    this.name = name;
    $("formslot").replaceChildren();
    if (this.listening) this.orb.listen(now, false);
    this.drop(this.question, now);
    this.rise(name, now);
    this.orb.flash(now + 1250);
    const words = [
      ...NICE.map((word) => ({ t: word.t, at: now + word.at })),
      { t: `${name}.`, at: now + NAME_AT, user: true, plainLast: true },
    ];
    this.say(`Nice to meet you, ${name}.`, now + NICE[0].at, { words, out: now + 4300 });
    this.signIn(now + 4700);
  }

  /** The user's words rise from below into the orb's empty centre. */
  rise(name, at) {
    const rise = document.createElement("div");
    rise.className = "user-rise";
    rise.setAttribute("aria-hidden", "true");
    rise.textContent = name;
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
    // Absorbed: gone from the page once the core has lit up (as in the prototype).
    this.timeline.at(at + 1500, () => rise.remove());
  }

  signIn(at) {
    this.timeline.at(at, () => {
      this.scene("sign-in");
      $("skip").hidden = true;
    });
    this.say(SAY.yours(this.name), at, { out: at + 2200 });
    this.signInLine = this.say(SAY.signIn, at + 2500, { stay: true });
    this.timeline.at(at + 3500, () => this.showSignIn());
  }

  showSignIn() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn primary";
    button.textContent = "Sign in with endue ID";
    button.addEventListener("click", () => this.showStub());
    $("formslot").replaceChildren(button);
  }

  /** endue ID is not connected yet: the stub lets a person pick the outcome. */
  showStub() {
    const box = document.createElement("div");
    box.className = "stub";
    const note = document.createElement("p");
    note.textContent = "endue ID is not connected yet. Pick what happens:";
    box.append(note);
    for (const [label, outcome] of [
      ["Success", "success"],
      ["New account", "fresh"],
      ["Failure", "failure"],
    ]) {
      const choice = document.createElement("button");
      choice.type = "button";
      choice.className = "btn";
      choice.textContent = label;
      choice.addEventListener("click", () => void this.signedIn(outcome));
      box.append(choice);
    }
    $("formslot").replaceChildren(box);
  }

  async signedIn(outcome) {
    const now = this.timeline.time;
    $("formslot").replaceChildren();
    this.drop(this.signInLine, now);
    if (outcome === "failure") {
      this.signInLine = this.say(SAY.failure, now + 300, { stay: true });
      this.timeline.at(now + 300, () => {
        const again = document.createElement("button");
        again.type = "button";
        again.className = "btn";
        again.textContent = "Open it again";
        again.addEventListener("click", () => this.showStub());
        $("formslot").replaceChildren(again);
      });
      return;
    }
    this.say(outcome === "fresh" ? SAY.fresh : SAY.success, now + 300, { stay: true });
    await this.ctx.bridge.call("store.set", {
      key: FIRST_RUN,
      value: { done: true, name: this.name ?? null },
    });
    this.timeline.at(now + 3000, () => this.finish());
  }

  skip() {
    const now = this.timeline.time;
    this.timeline.clear();
    $("cap").replaceChildren();
    $("skip").hidden = true;
    this.scene("sign-in");
    this.orb = buildOrb(document, this.timeline, $("sphere"), {
      assets: ASSETS,
      reduced,
      assembled: true,
    });
    this.say(SAY.brief, now + 200, { out: now + 1700 });
    this.signIn(now + 2000);
  }

  showSkip() {
    const skip = $("skip");
    skip.hidden = false;
    this.timeline.add(
      skip.animate([{ opacity: 0 }, { opacity: 1 }], {
        delay: TIMES.skipVisible,
        duration: 400,
        fill: "both",
      }),
    );
    skip.querySelector("button").addEventListener("click", () => this.skip(), { once: true });
  }

  welcomeBack(name) {
    this.scene("welcome-back");
    buildOrb(document, this.timeline, $("sphere"), { assets: ASSETS, reduced, quick: true });
    this.say(SAY.morning(name), 1200, { stay: true });
    this.timeline.at(4200, () => this.finish());
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

const ASSETS = "../../endue.eris/ui/assets";

defineUiPlugin({
  async mount(ctx) {
    let saved;
    try {
      saved = (await ctx.bridge.call("store.get", { key: FIRST_RUN })).value;
    } catch {
      saved = undefined;
    }
    const director = new Director(ctx);
    if (saved?.done) director.welcomeBack(saved.name);
    else director.firstRun();
  },
});
