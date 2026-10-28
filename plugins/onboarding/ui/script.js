// What Eris says in scenes 1-5, with timings. Scene 2 is the LINES table of
// docs/reference/eris-opening-prototype.html, unchanged: { t: word, at: start ms, cap?, gold? }.
// In the app these start times will come from TTS word timestamps.

export const GREETING = [
  { index: 0, words: [{ t: "Hello.", at: 3000 }], out: 4400 },
  {
    index: 1,
    words: [
      { t: "I'm", at: 4800 },
      { t: "E.", at: 5200, gold: true },
      { t: "R.", at: 5500, gold: true },
      { t: "I.", at: 5800, gold: true },
      { t: "S.", at: 6100, gold: true },
    ],
    out: 7400,
  },
  {
    index: 2,
    words: [
      { t: "Endue's", cap: 7800, at: 8050 },
      { t: "Ridiculously", cap: 7800, at: 8450 },
      { t: "Impressive", cap: 7800, at: 9000 },
      { t: "Secretary.", cap: 7800, at: 9450 },
    ],
    out: 11000,
  },
  {
    index: 3,
    words: [
      { t: "Small,", at: 11500 },
      { t: "I", at: 11900 },
      { t: "know.", at: 12050 },
    ],
    out: 13400,
  },
  {
    index: 4,
    words: [
      { t: "But", at: 13800 },
      { t: "I'll", at: 14000 },
      { t: "take", at: 14200 },
      { t: "care", at: 14400 },
      { t: "of", at: 14600 },
      { t: "your", at: 14700 },
      { t: "whole", at: 14900 },
      { t: "desk.", at: 15150 },
    ],
    out: 16600,
  },
];

/** The question of scene 4, with the prototype's ASK timings relative to when it starts. */
export const ASK = [
  { t: "What", at: 0 },
  { t: "should", at: 200 },
  { t: "I", at: 450 },
  { t: "call", at: 550 },
  { t: "you?", at: 800 },
];

/** "Nice to meet you, <name>." relative to the reply (prototype). */
export const NICE = [
  { t: "Nice", at: 1300 },
  { t: "to", at: 1500 },
  { t: "meet", at: 1620 },
  { t: "you,", at: 1800 },
];
export const NAME_AT = 2050;

/** Scene times (ms on the first-run timeline). */
export const TIMES = {
  skipVisible: 1000,
  greeting: 3000,
  talk: 17000,
  microphone: 19000,
  askMic: 20400,
  afterMic: 21000,
  formDelay: 1600,
};

export const SAY = {
  talk: "I'd rather talk than type.",
  microphone: "May I use your microphone?",
  listening: "Thanks. I'm listening.",
  typing: "That's fine. Type to me instead.",
  ask: "What should I call you?",
  again: "Didn't catch that. One more time?",
  yours: (name) => (name ? `Let's make this desk yours, ${name}.` : "Let's make this desk yours."),
  signIn: "Sign in, and I'll remember you on every desk.",
  success: "Got it. Welcome in.",
  fresh: "A fresh account. Even better.",
  failure: "Sign-in didn't go through. The link may have expired. Open it again?",
  brief: "Fine. I'll be brief.",
  morning: (name) => (name ? `Morning, ${name}.` : "Morning."),
};
