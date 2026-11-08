/**
 * One Eris in two windows (ADR 0027, ADR 0121). The desk's runtime keeps her state; the floating
 * window over the OS shows it while the desk is inactive and talks to her in the same conversation.
 * The two windows share the app's storage (one origin), so the desk writes a snapshot of her and the
 * floating window writes back what was said there; each hears the other's writes as `storage`
 * events, as the palette window hears the theme (ADR 0056). Nothing here knows Tauri.
 */
import type { ErisState } from "./states";
import { ERIS_STATES } from "./states";
import type { TalkPhase } from "./talk";

/** The desk's snapshot of her, for the floating window. */
export const SNAPSHOT_KEY = "desk.eris.float";
/** What the floating window says back. */
export const BACK_KEY = "desk.eris.float.back";
/** How many lines of the conversation both windows keep. */
export const MAX_LINES = 12;

/** What the floating Eris shows she is doing. */
export type FloatStatus = "idle" | "listening" | "thinking" | "speaking" | "approval";

/** One line of the conversation: the person's or hers. */
export interface ErisLine {
  who: "you" | "eris";
  text: string;
}

export interface ErisSnapshot {
  v: 1;
  /** Counts up with every write, so each write is new to the other window. */
  seq: number;
  state: ErisState;
  talk: TalkPhase;
  /** Her latest line in the desk. */
  saying: string;
  lines: ErisLine[];
}

/** What the floating window tells the desk. */
export interface ErisBack {
  v: 1;
  seq: number;
  /** A line said in the floating window: the person's, or her answer. */
  line?: ErisLine;
  /** Her state while a floating turn runs (thinking), and after it (idle). */
  state?: ErisState;
  /** Her answer, for the desk's Eris to say once the desk is in front. */
  said?: string;
}

/** Text both windows read and write under a key, and hear the other window write. */
export interface LinkChannel {
  read(key: string): string | null;
  write(key: string, text: string): void;
  listen(key: string, listener: (text: string | null) => void): () => void;
}

/** The app's storage, which every window of the app shares; a window without it links to nothing. */
export function storageChannel(win: Window = window): LinkChannel {
  const storage = (): Storage | undefined => {
    try {
      return win.localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    read: (key) => {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    write: (key, text) => {
      try {
        storage()?.setItem(key, text);
      } catch {
        // Storage full or refused: the other window keeps what it last heard.
      }
    },
    listen: (key, listener) => {
      const heard = (event: StorageEvent) => {
        if (event.key === key) listener(event.newValue);
      };
      win.addEventListener("storage", heard);
      return () => win.removeEventListener("storage", heard);
    },
  };
}

/**
 * Two linked channels in memory, the way two windows share storage: a write on one is heard on the
 * other (never on itself). For tests and pages without a second window.
 */
export function pairedChannels(): [LinkChannel, LinkChannel] {
  const values = new Map<string, string>();
  const ears = [new Map<string, Set<(text: string | null) => void>>(), new Map()];
  const side = (me: 0 | 1): LinkChannel => ({
    read: (key) => values.get(key) ?? null,
    write: (key, text) => {
      if (values.get(key) === text) return;
      values.set(key, text);
      for (const listener of [...(ears[me === 0 ? 1 : 0]?.get(key) ?? [])]) listener(text);
    },
    listen: (key, listener) => {
      const mine = ears[me] as Map<string, Set<(text: string | null) => void>>;
      const set = mine.get(key) ?? new Set();
      set.add(listener);
      mine.set(key, set);
      return () => set.delete(listener);
    },
  });
  return [side(0), side(1)];
}

/** What she shows: an approval waiting first, then what her turn or the desk says she does. */
export function statusOf(input: {
  state: ErisState;
  talk: TalkPhase;
  thinking: boolean;
  speaking: boolean;
  approval: boolean;
}): FloatStatus {
  if (input.approval) return "approval";
  if (input.talk === "listening" || input.state === "listening") return "listening";
  if (input.thinking || input.talk === "thinking" || input.state === "thinking") return "thinking";
  if (input.speaking || input.talk === "speaking") return "speaking";
  return "idle";
}

/** `lines` with `line` after them: blank lines and a repeat of the last one are left out. */
export function keepLines(lines: readonly ErisLine[], line: ErisLine): ErisLine[] {
  const text = line.text.trim();
  const last = lines[lines.length - 1];
  if (!text || (last?.who === line.who && last.text === text)) return [...lines];
  return [...lines, { who: line.who, text }].slice(-MAX_LINES);
}

const isState = (value: unknown): value is ErisState =>
  typeof value === "string" && (ERIS_STATES as readonly string[]).includes(value);
const PHASES: readonly TalkPhase[] = ["off", "listening", "thinking", "speaking"];

function isLine(value: unknown): value is ErisLine {
  const line = value as Partial<ErisLine> | null;
  return (
    typeof line === "object" &&
    line !== null &&
    (line.who === "you" || line.who === "eris") &&
    typeof line.text === "string"
  );
}

function parse(text: string | null): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text ?? "null");
    return typeof value === "object" && value !== null && (value as { v?: unknown }).v === 1
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** A snapshot as the desk wrote it, or undefined when the text is not one. */
export function readSnapshot(text: string | null): ErisSnapshot | undefined {
  const value = parse(text);
  if (!value || !isState(value.state) || !PHASES.includes(value.talk as TalkPhase))
    return undefined;
  return {
    v: 1,
    seq: Number(value.seq) || 0,
    state: value.state,
    talk: value.talk as TalkPhase,
    saying: typeof value.saying === "string" ? value.saying : "",
    lines: Array.isArray(value.lines) ? value.lines.filter(isLine).slice(-MAX_LINES) : [],
  };
}

/** What the floating window wrote back, or undefined when the text is not that. */
export function readBack(text: string | null): ErisBack | undefined {
  const value = parse(text);
  if (!value) return undefined;
  return {
    v: 1,
    seq: Number(value.seq) || 0,
    ...(isLine(value.line) ? { line: value.line } : {}),
    ...(isState(value.state) ? { state: value.state } : {}),
    ...(typeof value.said === "string" && value.said.trim() ? { said: value.said } : {}),
  };
}

/** The floating window's side: hear the desk's snapshots, and write back. */
export interface FloatSide {
  /** The desk's latest snapshot, if it wrote one. */
  snapshot(): ErisSnapshot | undefined;
  onSnapshot(listener: (snapshot: ErisSnapshot) => void): () => void;
  back(back: Omit<ErisBack, "v" | "seq">): void;
}

export function floatSide(channel: LinkChannel): FloatSide {
  let seq = 0;
  return {
    snapshot: () => readSnapshot(channel.read(SNAPSHOT_KEY)),
    onSnapshot: (listener) =>
      channel.listen(SNAPSHOT_KEY, (text) => {
        const snapshot = readSnapshot(text);
        if (snapshot) listener(snapshot);
      }),
    back: (back) => channel.write(BACK_KEY, JSON.stringify({ v: 1, seq: ++seq, ...back })),
  };
}
