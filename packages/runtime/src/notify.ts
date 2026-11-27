/**
 * Notifications (desk.notify, like the echo area and *Messages*): one shows in the status line for
 * as long as its level says, every one goes to the history, and do-not-disturb holds back the levels
 * it does not allow until it ends. A notice that stays until it is dismissed (one with actions, ADR
 * 0061, or of a level that shows for 0 ms: an error by default) is not lost under a newer one: that
 * one covers it for its own time, then it shows again (#158). The notification centre reads the
 * history (#307): how many arrived since it was last open (`unread`, `markRead`), one taken out
 * (`remove`) or all of them (`clear`), and a word for each change (`onChange`).
 */
import type { NotifyLevel } from "@endue-ai/bridge";
import type { Clock } from "./clock";

/** A button on a notice: a desk command to run, with its arguments. Plain data, so it is kept. */
export interface NoticeAction {
  label: string;
  command: string;
  args?: unknown;
}

export interface Notice {
  id: string;
  /** The plugin that asked, or `desk` for the runtime itself. */
  caller: string;
  title: string;
  body?: string;
  level: NotifyLevel;
  /** When it arrived, on the injected clock. */
  at: number;
  /**
   * When it arrived on the wall clock, in ms since the epoch: the day and time the notification
   * centre shows. Kept across a restart; absent on one kept from before it was recorded.
   */
  time?: number;
  /** Held back by do-not-disturb: in the history, never shown. */
  held: boolean;
  actions?: NoticeAction[];
}

export interface NotifySettings {
  /** How long each level shows, in ms; 0 shows it until it is dismissed. */
  durations: Record<NotifyLevel, number>;
  dnd: boolean;
  /** Levels that still show during do-not-disturb. */
  dndAllows: NotifyLevel[];
  /** How many notices the history keeps. */
  history: number;
}

export const DEFAULT_NOTIFY: NotifySettings = {
  durations: { info: 4000, success: 4000, warning: 8000, error: 0 },
  dnd: false,
  dndAllows: ["error"],
  history: 200,
};

export type NoticeInput = Pick<Notice, "caller" | "title"> &
  Partial<Pick<Notice, "id" | "body" | "level" | "actions">>;

export class Notifications {
  readonly #clock: Clock;
  readonly #render: (notice: Notice | null) => void;
  readonly #wall: () => number;
  #settings: NotifySettings = DEFAULT_NOTIFY;
  #history: Notice[] = [];
  /** Those that arrived since the notification centre was last open, held ones included. */
  readonly #unread = new Set<Notice>();
  #current: Notice | null = null;
  /** Notices that stay which a newer one covered, oldest first. */
  #waiting: Notice[] = [];
  #until = Number.POSITIVE_INFINITY;
  #cancel: (() => void) | undefined;
  #nextId = 1;
  readonly #listeners = new Set<(notice: Notice) => void>();
  readonly #changes = new Set<() => void>();

  /** `wall` is the wall clock a notice's `time` is read from. */
  constructor(clock: Clock, render: (notice: Notice | null) => void, wall = () => Date.now()) {
    this.#clock = clock;
    this.#render = render;
    this.#wall = wall;
  }

  configure(settings: NotifySettings): void {
    const endsDnd = this.#settings.dnd && !settings.dnd;
    this.#settings = settings;
    this.#trim();
    if (!endsDnd) return;
    const held = this.#history.filter((notice) => notice.held);
    if (held.length > 0) {
      const s = held.length === 1 ? "" : "s";
      this.push({
        caller: "desk",
        title: `${held.length} notification${s} while you were away`,
        level: "info",
      });
    }
  }

  get settings(): NotifySettings {
    return this.#settings;
  }

  push(input: NoticeInput): Notice {
    const level = input.level ?? "info";
    const held = this.#settings.dnd && !this.#settings.dndAllows.includes(level);
    const notice: Notice = {
      id: input.id ?? `desk-${this.#nextId++}`,
      caller: input.caller,
      title: input.title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.actions?.length ? { actions: input.actions } : {}),
      level,
      at: this.#clock.now(),
      time: this.#wall(),
      held,
    };
    this.#history.push(notice);
    this.#unread.add(notice);
    this.#trim();
    if (!held) this.#show(notice);
    for (const listener of this.#listeners) listener(notice);
    this.#changed();
    return notice;
  }

  /** Hear every notice that arrives, shown or held. */
  onPush(listener: (notice: Notice) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Hear each change to the history or to what is read: a push, `markRead`, `remove`, `clear`. */
  onChange(listener: () => void): () => void {
    this.#changes.add(listener);
    return () => this.#changes.delete(listener);
  }

  /** How many notices arrived since the last `markRead`, held ones included. */
  unread(): number {
    return this.#unread.size;
  }

  /** The notification centre was opened: every notice in the history is read. */
  markRead(): void {
    if (this.#unread.size === 0) return;
    this.#unread.clear();
    this.#changed();
  }

  /** The notice showing now, or null. */
  current(): Notice | null {
    return this.#current;
  }

  /** Whether `notice` shows until it is dismissed (or acted on), rather than for its level's time. */
  stays(notice: Notice): boolean {
    return this.#duration(notice) <= 0;
  }

  dismiss(id?: string): boolean {
    if (id !== undefined && this.#current?.id !== id) {
      const before = this.#waiting.length;
      this.#waiting = this.#waiting.filter((notice) => notice.id !== id);
      return this.#waiting.length !== before;
    }
    this.#cancel?.();
    this.#cancel = undefined;
    if (this.#current === null) return false;
    this.#current = null;
    const next = this.#waiting.shift();
    if (next) this.#show(next);
    else this.#render(null);
    return true;
  }

  /** Newest first. */
  history(): Notice[] {
    return [...this.#history].reverse();
  }

  /**
   * Take notice `id` out of the history: off the status line if it shows there, and never shown
   * again if a newer one covers it.
   */
  remove(id: string): void {
    const notice = this.#history.find((n) => n.id === id);
    if (!notice) return;
    this.#history = this.#history.filter((n) => n !== notice);
    this.#unread.delete(notice);
    this.#waiting = this.#waiting.filter((n) => n !== notice);
    if (this.#current === notice) this.dismiss();
    this.#changed();
  }

  /** Empty the history; the notice showing stays until it ends, those it covers are gone too. */
  clear(): void {
    this.#history = [];
    this.#unread.clear();
    this.#waiting = [];
    this.#changed();
  }

  /**
   * Put back a history kept from an earlier session (oldest first), before anything new: read
   * there, so none of it is unread here.
   */
  restore(notices: readonly Notice[]): void {
    this.#history = [...notices.map((notice) => ({ ...notice, at: 0 })), ...this.#history];
    this.#trim();
    this.#changed();
  }

  dispose(): void {
    this.#cancel?.();
  }

  #show(notice: Notice): void {
    this.#cancel?.();
    const covered = this.#current;
    if (covered && covered !== notice && this.stays(covered)) this.#waiting.push(covered);
    this.#current = notice;
    this.#render(notice);
    const duration = this.#duration(notice);
    this.#until = duration > 0 ? notice.at + duration : Number.POSITIVE_INFINITY;
    if (duration <= 0) return;
    const step = (now: number) => {
      if (now >= this.#until) this.dismiss();
      else this.#cancel = this.#clock.requestFrame(step);
    };
    this.#cancel = this.#clock.requestFrame(step);
  }

  #duration(notice: Notice): number {
    return notice.actions ? 0 : this.#settings.durations[notice.level];
  }

  #trim(): void {
    const extra = this.#history.length - Math.max(0, this.#settings.history);
    if (extra <= 0) return;
    for (const notice of this.#history.splice(0, extra)) this.#unread.delete(notice);
  }

  #changed(): void {
    for (const listener of [...this.#changes]) listener();
  }
}

/** The status line text for a notice: "Title — body". */
export function noticeText(notice: Notice): string {
  return notice.body ? `${notice.title} — ${notice.body}` : notice.title;
}
