// What a file opener keeps when the desk puts its window to sleep (ui.surface.state, ADR 0070, ADR
// XXXX), and how it comes back. It keeps the files open in the frame, the one on screen, where the
// person was in each (`place`: a page and zoom, a caret and scroll) and the unsaved edits, fitted
// into the 64 KiB the desk keeps: a file's edit may come in several forms, best first (the whole
// text, then only what changed), and what does not fit goes first from the files used longest ago.
// The files always fit, so the desk never lists a buffer the opener forgot. Back from a sleep, the
// opener takes each kept file as it opens it again; until then the file stays kept, so a window that
// sleeps again before it has opened them all still keeps them.
import type { PluginSurface } from "./sdk";
import { STATE_LIMIT } from "./surface-state";

/** One file open in the opener, as it is now. */
export interface OpenFile<Place = unknown, Edit = unknown> {
  buffer: string;
  path: string;
  /** Where the person is in the file, and the little it takes to open it again. Kept while it fits. */
  place?: Place;
  /** Its unsaved edits, best form first; the first that fits is kept. None: nothing unsaved. */
  edits?: readonly Edit[];
}

/** One file as it was kept. */
export interface KeptFile<Place = unknown, Edit = unknown> {
  buffer: string;
  path: string;
  place?: Place;
  edit?: Edit;
  /** It had unsaved edits and none fit (or none read back): it comes back as it is on disk. */
  lost?: true;
}

export interface KeepFilesOptions<Place, Edit> {
  /** The files open in the frame, in the order they were opened: the last is the most recent. */
  files(): readonly OpenFile<Place, Edit>[];
  /** The buffer on screen, or null. */
  shown(): string | null;
  /** Check a kept place, maybe another version's; undefined drops it. */
  readPlace?(value: unknown): Place | undefined;
  /** Check a kept edit, maybe another version's; undefined drops it, and the file is `lost`. */
  readEdit?(value: unknown): Edit | undefined;
}

export interface KeptFiles<Place, Edit> {
  /** The buffer that was on screen before the sleep; null after a cold start. */
  readonly shown: string | null;
  /** The kept files not taken yet, in the order they were open. */
  files(): KeptFile<Place, Edit>[];
  /** The kept file of `buffer`, taken out once it is open again (or closed); undefined if none. */
  take(buffer: string): KeptFile<Place, Edit> | undefined;
  /** Stop answering ui.surface.state. */
  off(): void;
}

const VERSION = 1;

/** The state keepFiles answers ui.surface.state with. */
export interface KeptState {
  v: number;
  files: KeptFile[];
  shown: string | null;
}

const bytes = (value: unknown): number => {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? 0 : new TextEncoder().encode(json).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** One file's record and how its size goes down: a smaller edit, no edit, no place, not at all. */
class Entry {
  edit = 0;
  place = true;
  kept = true;
  readonly #sizes = new Map<string, number>();

  constructor(
    readonly file: OpenFile,
    readonly lostBefore: boolean,
  ) {}

  get edits(): readonly unknown[] {
    return this.file.edits ?? [];
  }

  record(): KeptFile {
    const { buffer, path, place } = this.file;
    const edit = this.edits[this.edit];
    const lost = this.lostBefore || (this.edits.length > 0 && edit === undefined);
    return {
      buffer,
      path,
      ...(this.place && place !== undefined ? { place } : {}),
      ...(edit !== undefined ? { edit } : {}),
      ...(lost ? { lost: true as const } : {}),
    };
  }

  size(): number {
    if (!this.kept) return 0;
    const key = `${this.edit}:${this.place}`;
    let size = this.#sizes.get(key);
    if (size === undefined) {
      size = bytes(this.record());
      this.#sizes.set(key, size);
    }
    return size;
  }
}

/**
 * The state to keep, at most `limit` bytes of UTF-8 JSON: every file with its place and best edit
 * when they fit. Otherwise, from the least important file up (the files in the order opened, the
 * one on screen last): smaller forms of their edits, then no edits, then no places, then fewer files.
 */
export function fitFiles(
  files: readonly OpenFile[],
  shown: string | null,
  limit = STATE_LIMIT,
  lost: ReadonlySet<string> = new Set(),
): KeptState {
  const entries = files.map((file) => new Entry(file, lost.has(file.buffer)));
  const order = [
    ...entries.filter((e) => e.file.buffer !== shown),
    ...entries.filter((e) => e.file.buffer === shown),
  ];
  const base = bytes({ v: VERSION, files: [], shown });
  const total = () => {
    const kept = entries.filter((e) => e.kept);
    return base + kept.reduce((sum, e) => sum + e.size(), 0) + Math.max(0, kept.length - 1);
  };
  /** Make `e` one step smaller of the kind; false when that kind has nothing more to take. */
  const shrink = (e: Entry, kind: "smaller" | "edit" | "place" | "file"): boolean => {
    if (kind === "smaller" && e.edit < e.edits.length - 1) e.edit++;
    else if (kind === "edit" && e.edit < e.edits.length) e.edit = e.edits.length;
    else if (kind === "place" && e.place) e.place = false;
    else if (kind === "file" && e.kept && e.file.buffer !== shown) e.kept = false;
    else return false;
    return true;
  };
  for (const kind of ["smaller", "edit", "place", "file"] as const) {
    for (const entry of order) {
      while (total() > limit && shrink(entry, kind)) {}
    }
  }
  const kept = entries.filter((e) => e.kept).map((e) => e.record());
  return { v: VERSION, files: kept, shown: kept.some((f) => f.buffer === shown) ? shown : null };
}

const isText = (value: unknown): value is string => typeof value === "string" && value !== "";

/** The kept files of a restored state, or none when it is not one (cold, another version's). */
function readKept<Place, Edit>(
  value: unknown,
  options: KeepFilesOptions<Place, Edit>,
): { files: KeptFile<Place, Edit>[]; shown: string | null } {
  const kept = value as Partial<KeptState> | null;
  if (typeof kept !== "object" || kept === null || kept.v !== VERSION || !Array.isArray(kept.files))
    return { files: [], shown: null };
  const files: KeptFile<Place, Edit>[] = [];
  for (const raw of kept.files as Array<Partial<KeptFile> | null>) {
    if (!isText(raw?.buffer) || !isText(raw?.path) || files.some((f) => f.buffer === raw.buffer))
      continue;
    const place = raw.place === undefined ? undefined : read(options.readPlace, raw.place);
    const edit = raw.edit === undefined ? undefined : read(options.readEdit, raw.edit);
    const lost = raw.lost === true || (raw.edit !== undefined && edit === undefined);
    files.push({
      buffer: raw.buffer,
      path: raw.path,
      ...(place !== undefined ? { place } : {}),
      ...(edit !== undefined ? { edit } : {}),
      ...(lost ? { lost: true as const } : {}),
    });
  }
  const shown =
    isText(kept.shown) && files.some((f) => f.buffer === kept.shown) ? kept.shown : null;
  return { files, shown };
}

const read = <T>(check: ((value: unknown) => T | undefined) | undefined, value: unknown) =>
  check ? check(value) : (value as T);

/**
 * Keep an opener's files across a sleep: answers ui.surface.state with `fitFiles` of what the frame
 * holds and of the kept files it has not taken yet, and reads back what the last sleep kept.
 */
export function keepFiles<Place = unknown, Edit = unknown>(
  surface: Pick<PluginSurface, "onUnload" | "restored">,
  options: KeepFilesOptions<Place, Edit>,
): KeptFiles<Place, Edit> {
  const restored = readKept(surface.restored, options);
  const waiting = new Map(restored.files.map((file) => [file.buffer, file]));
  const off = surface.onUnload(() => {
    const open = options.files();
    const held = new Set(open.map((file) => file.buffer));
    const left = [...waiting.values()].filter((file) => !held.has(file.buffer));
    const lost = new Set(left.filter((file) => file.lost).map((file) => file.buffer));
    const before = left.map(({ buffer, path, place, edit }) => ({
      buffer,
      path,
      ...(place !== undefined ? { place } : {}),
      ...(edit !== undefined ? { edits: [edit] } : {}),
    }));
    const shown = options.shown() ?? (waiting.has(restored.shown ?? "") ? restored.shown : null);
    return fitFiles([...before, ...open], shown, STATE_LIMIT, lost);
  });
  return {
    shown: restored.shown,
    files: () => [...waiting.values()],
    take: (buffer) => {
      const file = waiting.get(buffer);
      waiting.delete(buffer);
      return file;
    },
    off,
  };
}
