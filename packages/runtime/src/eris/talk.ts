/**
 * A spoken turn with Eris, started by clicking her. She listens (the microphone, or a recorded sample
 * voice when there is none), thinks (the brain answers what the platform recognised, or a sample line
 * answers), and speaks (soul text, one pulse per syllable, the platform's voice). Each phase is one of
 * her states, so the mesh flows from listening to thinking to speaking. Time comes in through
 * `toggle(now)` and `update(now)`, so tests drive it frame by frame.
 */
import { wordTimes } from "../bridge/browser";
import type { Bands, WordTime } from "../bridge/types";
import { syllablePulses } from "./mouth";
import type { ErisState } from "./states";

export type TalkPhase = "off" | "listening" | "thinking" | "speaking";
export type TalkLang = "ko" | "en";

/** Where the user's voice comes from during a turn. */
export interface Ear {
  /** Nine band energies (0..1) at `now`. */
  bands(now: number): Bands;
  /** Stop listening; resolves with what the platform recognised ("" when it cannot). */
  close(): Promise<string>;
  /** False for the recorded sample voice. */
  readonly live: boolean;
}

/** The platform's voice saying a line. */
export interface Speech {
  readonly done: Promise<void>;
  stop(): void;
}

export interface Reply {
  text: string;
  words?: WordTime[];
}

export interface TalkDeps {
  lang(): TalkLang;
  /** The microphone, after the person allows it; null when there is none or it was refused. */
  openEar(): Promise<Ear | null>;
  /** The recorded sample voice, starting at `at`. */
  sampleEar(at: number): Ear;
  answer(heard: string): Promise<Reply>;
  /** Show the line as soul text with these pulses (ms after it starts); returns when it starts. */
  line(text: string, words: WordTime[], pulses: number[]): number;
  /** Say the line aloud; null when the platform has no voice. */
  voice(text: string, lang: TalkLang): Speech | null;
  setState(state: ErisState): void;
  /** Stop the soul text and the pulses that have not left the core. */
  hush(): void;
}

/** Mean band energy above this is speech. */
export const SPEECH_LEVEL = 0.1;
/** Silence this long after speech ends listening. */
export const END_SILENCE_MS = 1100;
/** Nothing heard for this long ends listening. */
export const NO_SPEECH_MS = 8000;
export const MAX_LISTEN_MS = 15000;
/** Thinking shows at least this long, so it reads even when the answer is instant. */
export const MIN_THINK_MS = 1100;
/** Without a microphone, the sample voice starts after this pause. */
export const SAMPLE_DELAY_MS = 500;
/** Speaking time per character when the answer has no timestamps (and to time syllables). */
export const MS_PER_CHAR: Record<TalkLang, number> = { ko: 140, en: 62 };
/** After the estimated last syllable, the line is still being said for this long. */
const TAIL_MS = 400;
/** A voice that never says it finished is given up on this long after the estimate. */
export const SPEECH_GRACE_MS = 6000;

/** What she says when no words were recognised; short enough for one line of soul text. */
export const SAMPLE_LINES = {
  heard: { ko: "잘 들었어요. 지금은 샘플 답이에요.", en: "I heard you. This is a sample answer." },
  nothing: {
    ko: "잘 안 들렸어요. 다시 말해 주세요.",
    en: "I didn't catch that. Tap and try again.",
  },
  sample: {
    ko: "샘플 목소리를 들었어요. 이렇게 말해요.",
    en: "I heard a sample voice. This is how I talk.",
  },
} as const;

const SILENT: Bands = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);
const mean = (b: Bands) => b.reduce((a, v) => a + v, 0) / Math.max(1, b.length);

export class Talk {
  readonly #deps: TalkDeps;
  #phase: TalkPhase = "off";
  /** Bumped by every new turn and every stop, so late answers from an old turn are dropped. */
  #turn = 0;
  #now = 0;
  #ear: Ear | undefined;
  #sample = false;
  #since = 0;
  #heard = false;
  #lastLoud = 0;
  #reply: Reply | undefined;
  #voiceAt: { at: number; text: string } | undefined;
  #speech: Speech | undefined;
  #until = 0;

  constructor(deps: TalkDeps) {
    this.#deps = deps;
  }

  get phase(): TalkPhase {
    return this.#phase;
  }

  /** A click: start listening; while listening, stop and answer; otherwise start over. */
  toggle(now: number): void {
    this.#now = now;
    if (this.#phase === "listening") {
      this.#think(now);
      return;
    }
    this.#stop();
    this.#listen(now);
  }

  /** Escape, or the user talking over her: end the turn where it is. */
  cancel(): void {
    if (this.#phase === "off") return;
    this.#stop();
    this.#deps.setState("idle");
  }

  dispose(): void {
    this.#stop();
  }

  /** Once per frame. Returns the user's bands while she listens, silence otherwise. */
  update(now: number): Bands {
    this.#now = now;
    if (this.#phase === "listening") return this.#listening(now);
    if (this.#phase === "thinking" && this.#reply && now >= this.#since + MIN_THINK_MS) {
      this.#speak(this.#reply);
    }
    if (this.#phase === "speaking") {
      if (this.#voiceAt && now >= this.#voiceAt.at) this.#say(this.#voiceAt.text);
      const said = !this.#speech || now >= this.#until + SPEECH_GRACE_MS;
      if (said && !this.#voiceAt && now >= this.#until) {
        this.#speech = undefined;
        this.#phase = "off";
      }
    }
    return SILENT;
  }

  #listen(now: number): void {
    const turn = ++this.#turn;
    this.#phase = "listening";
    this.#since = now;
    this.#heard = false;
    this.#lastLoud = now;
    this.#sample = false;
    this.#deps.setState("listening");
    const arrive = (ear: Ear | null) => {
      if (turn !== this.#turn || this.#phase !== "listening") {
        void ear?.close();
        return;
      }
      // The clock starts once she can hear: a permission prompt is not silence.
      this.#since = this.#now;
      this.#lastLoud = this.#now;
      this.#sample = !ear;
      this.#ear = ear ?? this.#deps.sampleEar(this.#now + SAMPLE_DELAY_MS);
    };
    this.#deps.openEar().then(arrive, () => arrive(null));
  }

  #listening(now: number): Bands {
    if (!this.#ear) return SILENT;
    const bands = this.#ear.bands(now);
    if (mean(bands) > SPEECH_LEVEL) {
      this.#heard = true;
      this.#lastLoud = now;
    }
    const ended =
      (this.#heard && now - this.#lastLoud > END_SILENCE_MS) ||
      (!this.#heard && now - this.#since > NO_SPEECH_MS) ||
      now - this.#since > MAX_LISTEN_MS;
    if (ended) this.#think(now);
    return bands;
  }

  #think(now: number): void {
    const turn = this.#turn;
    const ear = this.#ear;
    const heard = this.#heard;
    const sample = this.#sample;
    this.#ear = undefined;
    this.#phase = "thinking";
    this.#since = now;
    this.#reply = undefined;
    this.#deps.setState("thinking");
    const lang = this.#deps.lang();
    const fallback = (key: keyof typeof SAMPLE_LINES): Reply => ({ text: SAMPLE_LINES[key][lang] });
    void (async () => {
      const text = ((await ear?.close().catch(() => "")) ?? "").trim();
      let reply: Reply;
      if (text) {
        reply = await this.#deps.answer(text).catch(() => fallback("heard"));
      } else {
        reply = fallback(sample ? "sample" : heard ? "heard" : "nothing");
      }
      if (turn === this.#turn && this.#phase === "thinking") this.#reply = reply;
    })();
  }

  #speak(reply: Reply): void {
    const ms = MS_PER_CHAR[this.#deps.lang()];
    const words = reply.words?.length ? reply.words : wordTimes(reply.text, ms);
    const start = this.#deps.line(reply.text, words, syllablePulses(words, ms));
    const last = words.at(-1);
    this.#phase = "speaking";
    this.#reply = undefined;
    this.#voiceAt = { at: start, text: reply.text };
    this.#until = start + (last ? last.at + last.word.length * ms : 0) + TAIL_MS;
  }

  #say(text: string): void {
    const turn = this.#turn;
    this.#voiceAt = undefined;
    const speech = this.#deps.voice(text, this.#deps.lang()) ?? undefined;
    this.#speech = speech;
    void speech?.done.finally(() => {
      if (turn === this.#turn) this.#speech = undefined;
    });
  }

  #stop(): void {
    this.#turn++;
    void this.#ear?.close().catch(() => {});
    this.#ear = undefined;
    this.#speech?.stop();
    this.#speech = undefined;
    if (this.#phase === "speaking") this.#deps.hush();
    this.#voiceAt = undefined;
    this.#reply = undefined;
    this.#phase = "off";
  }
}
