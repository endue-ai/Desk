import type { AudioLevels, Bands, BrainReply, BrainStatus, ShellBridge, WordTime } from "./types";

/** A recorded band envelope: one nine-band frame every `frameMs`. */
export interface Envelope {
  frameMs: number;
  frames: number[][];
}

export interface BrowserBridgeOptions {
  /** Time source for the fake audio; the shell passes its injected clock's `now`. */
  now: () => number;
  /** Defaults to `window.localStorage` when present, else memory. */
  storage?: Pick<Storage, "getItem" | "setItem">;
  /** What `perm.request` answers; default: grant everything. */
  grant?: (scope: string) => boolean;
  brain?: BrainStatus;
}

/** The stub plus the knobs tests and the dev page turn. */
export interface BrowserBridge extends ShellBridge {
  fake: {
    /** Replay `envelope` as the user's microphone (or Eris's voice) from `at` (default now). */
    play(source: keyof AudioLevels, envelope: Envelope, at?: number): void;
    stop(source?: keyof AudioLevels): void;
    requests: string[];
  };
}

const SILENT: Bands = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PREFIX = "desk.shell.";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

/** Sample an envelope at `t` ms after its start, linearly between frames; silent outside it. */
export function sampleEnvelope(envelope: Envelope, t: number): Bands {
  if (t < 0) return SILENT;
  const position = t / envelope.frameMs;
  const i = Math.floor(position);
  const a = envelope.frames[i];
  if (!a) return SILENT;
  const b = envelope.frames[i + 1] ?? a;
  const f = position - i;
  return a.map((v, k) => v + ((b[k] ?? v) - v) * f);
}

/** Split a reply into word timestamps proportional to letters, as a voice without timestamps would. */
export function wordTimes(text: string, msPerChar = 55): WordTime[] {
  const out: WordTime[] = [];
  let chars = 0;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    out.push({ word, at: chars * msPerChar });
    chars += word.length + 1;
  }
  return out;
}

export function browserBridge(options: BrowserBridgeOptions): BrowserBridge {
  const store =
    options.storage ?? (typeof localStorage === "undefined" ? memoryStorage() : localStorage);
  const playing: Partial<Record<keyof AudioLevels, { envelope: Envelope; at: number }>> = {};
  const requests: string[] = [];
  let brain: BrainStatus = options.brain ?? { mode: "local", model: "llama-3.2-3b" };

  const level = (source: keyof AudioLevels): Bands => {
    const p = playing[source];
    return p ? sampleEnvelope(p.envelope, options.now() - p.at) : SILENT;
  };

  return {
    storage: {
      async get<T>(key: string) {
        const raw = store.getItem(PREFIX + key);
        return raw === null ? undefined : (JSON.parse(raw) as T);
      },
      async set(key, value) {
        store.setItem(PREFIX + key, JSON.stringify(value));
      },
    },
    perm: {
      async request(scope) {
        requests.push(scope);
        return options.grant ? options.grant(scope) : true;
      },
    },
    audio: {
      levels: () => ({ user: level("user"), eris: level("eris") }),
    },
    brain: {
      async status() {
        return brain;
      },
      async use(mode) {
        brain = mode === "local" ? { mode, model: "llama-3.2-3b" } : { mode, credits: 1200 };
        return brain;
      },
      async say(text): Promise<BrainReply> {
        const reply = text.trim() ? `I'll look into "${text.trim()}" and tell you.` : "I'm here.";
        return { text: reply, words: wordTimes(reply) };
      },
    },
    fake: {
      play(source, envelope, at) {
        playing[source] = { envelope, at: at ?? options.now() };
      },
      stop(source) {
        if (source) delete playing[source];
        else for (const key of Object.keys(playing)) delete playing[key as keyof AudioLevels];
      },
      requests,
    },
  };
}
