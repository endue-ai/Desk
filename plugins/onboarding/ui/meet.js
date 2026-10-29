// Scenes 2-5: the greeting, the microphone, the name and endue ID, plus Skip intro. endue ID is not
// connected yet, so a stub lets a person pick how sign-in ends.
import { buildOrb } from "eris/orb.js";
import { floor } from "./arrival.js";
import { $, ASSETS, element, reduced } from "./director.js";
import { cleanName } from "./flow.js";
import { ASK, GREETING, NAME_AT, NICE, SAY, TIMES } from "./script.js";

const HELP = "Still stuck? Write to team@endue.ai.";

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

/** Scene 5. Eris waits up and smaller while the browser signs in, and comes back down after. */
export function signIn(d, at) {
  d.timeline.at(at, () => {
    $("skip").hidden = true;
  });
  const yours = d.say(SAY.yours(d.state.name), at);
  const line = d.say(SAY.signIn, yours.out + 300, { stay: true });
  const failures = { count: 0 };
  d.timeline.at(yours.out + 1300, () => button(d, line, failures));
}

/** Offline, the browser is not opened: Eris says so, and the button comes back with the connection. */
function button(d, line, failures) {
  const open = element("button", "btn primary", "Sign in with endue ID");
  open.type = "button";
  open.addEventListener("click", () => {
    const now = d.timeline.time;
    $("formslot").replaceChildren();
    if (!navigator.onLine) d.drop(line, now);
    d.whenOnline(now, (at, waited) =>
      waited ? button(d, line, failures) : browser(d, line, failures, at),
    );
  });
  $("formslot").replaceChildren(open);
}

/** The browser is open: Eris moves up and waits; once, after 20 s, she says she is patient. */
function browser(d, line, failures, now) {
  d.drop(line, now);
  d.pose("up", now);
  const waiting = { done: false };
  d.timeline.at(now + 20000, () => {
    if (!waiting.done && !failures.patient) {
      failures.patient = true;
      d.say(SAY.patient, d.timeline.time);
    }
  });
  stub(d, failures, waiting);
}

/** endue ID is not connected yet: the stub lets a person pick the outcome. */
function stub(d, failures, waiting) {
  const box = element("div", "stub");
  box.append(element("p", "", "endue ID is not connected yet. Pick what happens:"));
  for (const [label, outcome] of [
    ["Success", "success"],
    ["New account", "fresh"],
    ["Failure", "failure"],
    ["Outside the US", "region"],
  ]) {
    const choice = element("button", "btn", label);
    choice.type = "button";
    choice.addEventListener("click", () => {
      waiting.done = true;
      signedIn(d, outcome, failures);
    });
    box.append(choice);
  }
  $("formslot").replaceChildren(box);
}

function signedIn(d, outcome, failures) {
  const now = d.timeline.time;
  $("formslot").replaceChildren();
  d.pose("centre", now);
  if (outcome === "failure") {
    failures.count += 1;
    const line = d.say(SAY.failure, now + 300, { stay: true });
    d.timeline.at(now + 300, () => {
      const again = element("button", "btn", "Open it again");
      again.type = "button";
      again.addEventListener("click", () => {
        const at = d.timeline.time;
        $("formslot").replaceChildren();
        d.drop(line, at);
        d.whenOnline(at + 300, (later, waited) =>
          waited ? button(d, { element: null }, failures) : browser(d, line, failures, later),
        );
      });
      $("formslot").replaceChildren(again);
      if (failures.count >= 3) $("formslot").append(element("p", "help", HELP));
    });
    return;
  }
  if (outcome === "region") {
    // Outside the service region (the US for now) the desk still works, without an account.
    d.state.region = false;
    const first = d.say(SAY.region, now + 300);
    const second = d.say(SAY.local, first.out + 300);
    d.advance(second.out + 300);
    return;
  }
  const welcome = d.say(outcome === "fresh" ? SAY.fresh : SAY.success, now + 300);
  d.advance(welcome.out + 300);
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
