// Scenes 2-4: the greeting, the microphone and the name, plus Skip intro. Scene 5, endue ID, is in
// account.js.
import { buildOrb } from "eris/orb.js";
import { floor } from "./arrival.js";
import { $, ASSETS, reduced } from "./director.js";
import { cleanName } from "./flow.js";
import { ASK, GREETING, NAME_AT, NICE, SAY, TIMES } from "./script.js";

/** Scene 2 from `shift` (the prototype's LINES, pushed back by the arrival). */
export function greeting(d, shift) {
  d.timeline.at(TIMES.greeting + shift, () => d.scene("greeting"));
  d.orb.turn(TIMES.greeting + shift, 13000);
  for (const line of GREETING) {
    const words = line.words.map((w) => ({
      ...w,
      at: w.at + shift,
      ...(w.cap === undefined ? {} : { cap: w.cap + shift }),
    }));
    const text = words.map((w) => w.t).join(" ");
    d.say(text, words[0].cap ?? words[0].at, { words, out: line.out + shift });
  }
  d.orb.shrink(GREETING[3].words[0].at + shift);
  d.go("microphone", TIMES.talk + shift);
}

/** Scene 3. While the system asks, Eris says nothing; a refusal switches her to typing. */
export function microphone(d, at) {
  const ask = TIMES.microphone - TIMES.talk;
  d.say(SAY.talk, at, { out: at + ask - 300 });
  const question = d.say(SAY.microphone, at + ask, { stay: true });
  d.timeline.at(at + TIMES.askMic - TIMES.talk, async () => {
    let granted = false;
    try {
      const answer = await d.ctx.bridge.call("perm.request", {
        permission: { permission: "audio:capture" },
        reason: "Eris listens when you talk to her. You can type instead.",
      });
      granted = answer.granted;
    } catch {
      granted = false;
    }
    if (d.current !== "microphone") return; // Skip intro was pressed meanwhile
    const now = Math.max(d.timeline.time, at + TIMES.afterMic - TIMES.talk);
    d.drop(question, now);
    d.state.listening = granted;
    d.state.micAsked = true;
    if (granted) d.orb.listen(now);
    d.say(granted ? SAY.listening : SAY.typing, now + 300, { out: now + 2300 });
    d.advance(now + 2600);
  });
}

/** Scene 4. The name rises into the orb's centre; an empty answer is asked for once more. */
export function name(d, at) {
  const words = ASK.map((word) => ({ t: word.t, at: at + word.at }));
  let question = d.say(SAY.ask, at, { words, stay: true });
  const answer = (value) => {
    const given = cleanName(value);
    const now = d.timeline.time;
    if (!given) {
      d.drop(question, now);
      question = d.say(SAY.again, now + 200, { stay: true });
      const input = $("formslot").querySelector("input");
      if (input) {
        input.value = "";
        input.focus();
      }
      return;
    }
    d.answered();
    d.state.name = given;
    if (d.state.listening) d.orb.listen(now, false);
    d.drop(question, now);
    d.rise(given, now);
    const nice = [
      ...NICE.map((word) => ({ t: word.t, at: now + word.at })),
      { t: `${given}.`, at: now + NAME_AT, user: true, plainLast: true },
    ];
    d.say(`Nice to meet you, ${given}.`, now + NICE[0].at, { words: nice, out: now + 4300 });
    d.advance(now + 4700);
  };
  d.ask(at, {
    question,
    label: "Type your name",
    placeholder: "Your name",
    autocomplete: "given-name",
    answer,
  });
}

/** Skip intro: no arrival or greeting; the orb is already assembled and sign-in comes next. */
export function skip(d) {
  const now = d.timeline.time;
  d.timeline.clear();
  d.voice.cancel();
  d.sound.stop();
  $("cap").replaceChildren();
  $("space").replaceChildren();
  $("skip").hidden = true;
  d.answered();
  d.scene("sign-in"); // "Fine. I'll be brief." already belongs to the sign-in
  d.state.skipped = true;
  d.orb = buildOrb(document, d.timeline, $("sphere"), { assets: ASSETS, reduced, assembled: true });
  if (!reduced) floor(d, { instant: true });
  const brief = d.say(SAY.brief, now + 200, { out: now + 1700 });
  d.go("sign-in", brief.out + 300);
}

export function showSkip(d) {
  const skipBox = $("skip");
  skipBox.hidden = false;
  d.timeline.add(
    skipBox.animate([{ opacity: 0 }, { opacity: 1 }], {
      delay: TIMES.skipVisible,
      duration: 400,
      fill: "both",
    }),
  );
  skipBox.querySelector("button").addEventListener("click", () => skip(d), { once: true });
}
