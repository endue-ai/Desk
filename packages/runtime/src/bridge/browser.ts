import { agentCard, type Directory, listAgents, listTasks, sampleDirectory } from "./directory";
import type {
  AccountStatus,
  AudioLevels,
  Bands,
  BrainReply,
  BrainStatus,
  BrainStep,
  ShellBridge,
  WordTime,
} from "./types";

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
  /** Wall-clock time the sample directory's timestamps are relative to (default: now). */
  epoch?: number;
  /**
   * The errands Eris runs for a line before she answers (ADR 0089), or undefined for none; the
   * default sends a line about mail to the mail plugin (`sampleErrand`).
   */
  errand?: (text: string) => { steps: BrainStep[]; reply: string } | undefined;
}

/** The stub plus the knobs tests and the dev page turn. */
export interface BrowserBridge extends ShellBridge {
  account: NonNullable<ShellBridge["account"]>;
  fake: {
    /** Replay `envelope` as the user's microphone (or Eris's voice) from `at` (default now). */
    play(source: keyof AudioLevels, envelope: Envelope, at?: number): void;
    stop(source?: keyof AudioLevels): void;
    requests: string[];
    /** The agent directory behind agents, spaces and a2a; tests edit it in place. */
    directory: Directory;
    /** Finish a sign-in under way, as the person would in the browser. */
    approveSignIn(): void;
  };
}

/** A line about mail goes to the mail plugin's latest-mail tool and comes back with two messages. */
export function sampleErrand(text: string): { steps: BrainStep[]; reply: string } | undefined {
  if (!/\bmail\b|메일|편지/i.test(text)) return undefined;
  const call = {
    callId: "call-mail",
    command: "endue.mail.latest",
    provider: "endue.mail",
    title: "Latest mail",
  };
  return {
    steps: [
      { kind: "tool", ...call },
      { kind: "tool-result", ...call, ok: true },
    ],
    reply: "You have 2 new messages. The newest is from Mina: Lunch today?",
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
  const directory = sampleDirectory(options.epoch ?? Date.now());
  let account: AccountStatus = { state: "signed-out" };
  const accountListeners = new Set<(status: AccountStatus) => void>();
  const changed = (next: AccountStatus) => {
    account = next;
    for (const listener of [...accountListeners]) listener(structuredClone(next));
  };
  // Answers are copies, as if they came over the wire.
  const wire = <T>(value: T): Promise<T> => Promise.resolve(structuredClone(value));

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
      async use(chosen) {
        brain =
          chosen === "local"
            ? { mode: "local", model: "llama-3.2-3b", brain: chosen }
            : { mode: "cloud", credits: 1200, brain: chosen };
        return brain;
      },
      async say(text, onStep): Promise<BrainReply> {
        const errand = (options.errand ?? sampleErrand)(text);
        for (const step of errand?.steps ?? []) {
          onStep?.(structuredClone(step));
          await Promise.resolve();
        }
        const reply =
          errand?.reply ??
          (text.trim() ? `I'll look into "${text.trim()}" and tell you.` : "I'm here.");
        return { text: reply, words: wordTimes(reply) };
      },
    },
    account: {
      status: () => wire(account),
      async signIn() {
        if (account.state !== "signing-in") {
          const signIn = { userCode: "WDJB-MJHT", verificationUri: "https://id.endue.ai/device" };
          changed({ state: "signing-in", signIn });
        }
        return structuredClone(account);
      },
      async signOut() {
        changed({ state: "signed-out" });
        return structuredClone(account);
      },
      onChange(listener) {
        accountListeners.add(listener);
        return () => accountListeners.delete(listener);
      },
    },
    agents: {
      list: async (query) => wire(listAgents(directory, query)),
      card: async (id) => wire(agentCard(directory, id)),
    },
    spaces: {
      list: async () => wire({ items: directory.spaces }),
    },
    a2a: {
      tasks: async (query) => wire(listTasks(directory, query)),
    },
    fake: {
      directory,
      approveSignIn() {
        if (account.state === "signing-in") changed({ state: "signed-in" });
      },
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
