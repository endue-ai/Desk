// What Eris says in the first run, with timings. Scene 2 is the LINES table of
// docs/reference/eris-opening-prototype.html, unchanged: { t: word, at: start ms, cap?, gold? }; the full
// arrival (scene 1) pushes it back by TIMES.arrival. In the app these start times will come from TTS
// word timestamps.

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

/** Scene 1's count: each number condenses and scatters like soul text. */
export const COUNT = [
  { t: "3", at: 2000, out: 2350 },
  { t: "2", at: 2500, out: 2850 },
  { t: "1", at: 3000, out: 3350 },
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

/** Scene times (ms on the first-run timeline, before the arrival shift). */
export const TIMES = {
  skipVisible: 1000,
  arrival: 5000,
  greeting: 3000,
  talk: 17000,
  microphone: 19000,
  askMic: 20400,
  afterMic: 21000,
  formDelay: 1600,
  silence: 8000,
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
  patient: "Take your time. I'm very patient. Mostly.",
  success: "Got it. Welcome in.",
  fresh: "A fresh account. Even better.",
  failure: "Sign-in didn't go through. The link may have expired. Open it again?",
  region: "endue isn't open in your region yet. It's US only for now.",
  local: "Your desk still works here, so let's set it up.",
  desk: "This is your desk. Nothing here is fixed. Ask, and I'll build what you need.",
  world: "To be useful, I need to see a little of your world. You choose what.",
  chosen: "That's all I'll look at. You can change it anytime.",
  team: "I don't work alone. Let me bring in the team.",
  waiting: "One more is waiting. You can meet Muse later.",
  edge: "They'll wait at the edge.",
  work: "Now give me something to do. Anything.",
  built: "This screen didn't exist a second ago. I built it for you.",
  discord: (a, b) => `Small bit of discord: ${a} and ${b} overlap. Move one?`,
  keep: "Want to keep this layout? Give it a name.",
  saved: (name) => `Saved. Say "${name}" and it comes back.`,
  tour: "That's the tour. I'll be right up here.",
  hey: 'Say "Hey Eris" anytime.',
  still: "Still there? You can type, too.",
  offline:
    "I can't reach endue right now. Check your connection, and I'll pick up where we left off.",
  brief: "Fine. I'll be brief.",
  resume: "Where were we? Right, your desk.",
  morning: (name) => (name ? `Morning, ${name}.` : "Morning."),
};

/**
 * endue's agents on a new desk (endue.ai): Tin, the everyday companion, is the one set up first; Seed
 * does research and Muse writes. Two say one line each; the rest wait as dim circles. The colours are
 * placeholders until the design system has persona tokens for them.
 */
export const AGENTS = [
  { id: "tin", name: "Tin", role: "Everyday companion", color: "#9fd8cb", speaks: true },
  { id: "seed", name: "Seed", role: "Research", color: "#b9dc92", speaks: true },
  { id: "muse", name: "Muse", role: "Writing", color: "#f0b5cf", speaks: false },
];

export const AGENT_SAY = {
  tin: (calendar, overlap) =>
    !calendar
      ? "Tin here. Connect a calendar and I'll keep it tidy."
      : overlap
        ? "Tin here. Two of tomorrow's meetings overlap. Want me to sort it out?"
        : "Tin here. Tomorrow looks clear. I'll keep it that way.",
  seed: () => "Seed. Give me a question you keep putting off.",
};

/** Scene 6's cards: what Eris may look at. Folder opens a folder picker, the others a connector. */
export const SOURCES = [
  { id: "folder", label: "Folder" },
  { id: "calendar", label: "Calendar" },
  { id: "mail", label: "Mail" },
];

/** Scene 8's examples and what each needs connected; with nothing connected only the last is left. */
export const EXAMPLES = [
  { kind: "tomorrow", text: "What's on tomorrow?", needs: "calendar" },
  { kind: "folder", text: "Summarize this folder", needs: "folder" },
  { kind: "week", text: "Plan my week", needs: null },
];
