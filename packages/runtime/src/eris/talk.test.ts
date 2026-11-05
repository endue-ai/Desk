import { describe, expect, test } from "vitest";
import { sampleEnvelope } from "../bridge/browser";
import userHello from "../bridge/envelopes/user-hello.json";
import type { Bands, WordTime } from "../bridge/types";
import { sampleEar } from "./ear";
import type { ErisState } from "./states";
import {
  type Ear,
  END_SILENCE_MS,
  MIN_THINK_MS,
  NO_SPEECH_MS,
  type Reply,
  SAMPLE_DELAY_MS,
  SAMPLE_LINES,
  Talk,
  type TalkDeps,
} from "./talk";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A turn with a fake ear and brain; records her states, lines and voice. */
function turn(options: { ear?: Ear | null; heard?: string; reply?: Reply } = {}) {
  const states: ErisState[] = [];
  const lines: { text: string; words: WordTime[]; pulses: number[] }[] = [];
  const said: string[] = [];
  const asked: string[] = [];
  let hushed = 0;
  let now = 0;
  const deps: TalkDeps = {
    lang: () => "en",
    openEar: async () => (options.ear === undefined ? null : options.ear),
    sampleEar: (at) => sampleEar(userHello, at),
    answer: async (text) => {
      asked.push(text);
      return options.reply ?? { text: `You said ${text}.` };
    },
    line: (text, words, pulses) => {
      lines.push({ text, words, pulses });
      return now;
    },
    voice: (text) => {
      said.push(text);
      return null;
    },
    setState: (s) => states.push(s),
    hush: () => {
      hushed++;
    },
  };
  const talk = new Talk(deps);
  const run = async (until: number, step = 20) => {
    for (; now <= until; now += step) {
      talk.update(now);
      await flush();
    }
  };
  return {
    talk,
    states,
    lines,
    said,
    asked,
    run,
    hushed: () => hushed,
    at: () => now,
  };
}

/** A microphone that hears `envelope`-like speech from `from` to `to`, and recognises `words`. */
function mic(from: number, to: number, words = ""): Ear {
  const loud: Bands = [0.3, 0.4, 0.4, 0.5, 0.5, 0.4, 0.3, 0.2, 0.1];
  return {
    live: true,
    bands: (now) => (now >= from && now < to ? loud : [0, 0, 0, 0, 0, 0, 0, 0, 0]),
    close: async () => words,
  };
}

describe("a spoken turn with Eris", () => {
  test("listens, thinks, then speaks what the brain answers", async () => {
    const t = turn({ ear: mic(100, 1200, "what's on today") });
    t.talk.toggle(0);
    expect(t.talk.phase).toBe("listening");
    expect(t.states).toEqual(["listening"]);
    await t.run(1200 + END_SILENCE_MS + 40);
    expect(t.talk.phase).toBe("thinking");
    expect(t.states.at(-1)).toBe("thinking");
    const thinking = t.at();
    await t.run(thinking + MIN_THINK_MS + 40);
    expect(t.asked).toEqual(["what's on today"]);
    expect(t.talk.phase).toBe("speaking");
    expect(t.lines[0]?.text).toBe("You said what's on today.");
    expect(t.said).toEqual(["You said what's on today."]);
    await t.run(t.at() + 5000);
    expect(t.talk.phase).toBe("off");
  });

  test("thinking shows for at least MIN_THINK_MS even when the answer is instant", async () => {
    const t = turn({ ear: mic(0, 200, "hi") });
    t.talk.toggle(0);
    await t.run(200 + END_SILENCE_MS + 20);
    const from = t.at();
    await t.run(from + MIN_THINK_MS - 100);
    expect(t.talk.phase).toBe("thinking");
    await t.run(from + MIN_THINK_MS + 40);
    expect(t.talk.phase).toBe("speaking");
  });

  test("without a microphone she listens to the sample voice and says the sample line", async () => {
    const t = turn({ ear: null });
    t.talk.toggle(0);
    await t.run(SAMPLE_DELAY_MS + 3000 + END_SILENCE_MS + MIN_THINK_MS + 200);
    expect(t.asked).toEqual([]);
    expect(t.lines[0]?.text).toBe(SAMPLE_LINES.sample.en);
  });

  test("the sample voice drives the user's rings while she listens", async () => {
    const t = turn({ ear: null });
    t.talk.toggle(0);
    await t.run(40);
    const bands = t.talk.update(SAMPLE_DELAY_MS + 200);
    expect(bands).toEqual(sampleEnvelope(userHello, 200));
    expect(Math.max(...bands)).toBeGreaterThan(0.1);
  });

  test("heard but not recognised: the 'heard' sample line; nothing heard: the 'nothing' line", async () => {
    const heard = turn({ ear: mic(0, 400) });
    heard.talk.toggle(0);
    await heard.run(400 + END_SILENCE_MS + MIN_THINK_MS + 100);
    expect(heard.lines[0]?.text).toBe(SAMPLE_LINES.heard.en);
    const quiet = turn({ ear: mic(0, 0) });
    quiet.talk.toggle(0);
    await quiet.run(NO_SPEECH_MS + MIN_THINK_MS + 100, 50);
    expect(quiet.lines[0]?.text).toBe(SAMPLE_LINES.nothing.en);
  });

  test("a click while she listens stops listening and answers", async () => {
    const t = turn({ ear: mic(0, 10_000, "stop here") });
    t.talk.toggle(0);
    await t.run(600);
    t.talk.toggle(t.at());
    expect(t.talk.phase).toBe("thinking");
    await t.run(t.at() + MIN_THINK_MS + 40);
    expect(t.asked).toEqual(["stop here"]);
  });

  test("a click while she speaks stops her and listens again; Escape ends the turn", async () => {
    const t = turn({ ear: mic(0, 200, "hello") });
    t.talk.toggle(0);
    await t.run(200 + END_SILENCE_MS + MIN_THINK_MS + 80);
    expect(t.talk.phase).toBe("speaking");
    t.talk.toggle(t.at());
    expect(t.hushed()).toBe(1);
    expect(t.talk.phase).toBe("listening");
    t.talk.cancel();
    expect(t.talk.phase).toBe("off");
    expect(t.states.at(-1)).toBe("idle");
  });

  test("an answer from a cancelled turn is dropped", async () => {
    let answer: (r: Reply) => void = () => {};
    const t = turn({ ear: mic(0, 200, "slow") });
    const talk = new Talk({
      lang: () => "en",
      openEar: async () => mic(0, 200, "slow"),
      sampleEar: (at) => sampleEar(userHello, at),
      answer: () => new Promise<Reply>((r) => (answer = r)),
      line: (text, words, pulses) => {
        t.lines.push({ text, words, pulses });
        return 0;
      },
      voice: () => null,
      setState: () => {},
      hush: () => {},
    });
    talk.toggle(0);
    await flush();
    talk.update(100);
    talk.toggle(150);
    await flush();
    talk.cancel();
    answer({ text: "too late" });
    await flush();
    talk.update(5000);
    expect(talk.phase).toBe("off");
    expect(t.lines).toEqual([]);
  });

  test("each syllable sends a pulse", async () => {
    const t = turn({ ear: mic(0, 200, "x"), reply: { text: "Good morning" } });
    t.talk.toggle(0);
    await t.run(200 + END_SILENCE_MS + MIN_THINK_MS + 80);
    // Good (1) + mor-ning (2)
    expect(t.lines[0]?.pulses).toHaveLength(3);
  });
});
