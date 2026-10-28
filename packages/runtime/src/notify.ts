/**
 * Notifications (desk.notify, like the echo area and *Messages*): one shows in the status line for
 * as long as its level says, every one goes to the history, and do-not-disturb holds back the levels
 * it does not allow until it ends.
 */
import type { NotifyLevel } from "@endue-ai/bridge";
import type { Clock } from "./clock";

export interface Notice {
  id: string;
  /** The plugin that asked, or `desk` for the runtime itself. */
  caller: string;
  title: string;
  body?: string;
  level: NotifyLevel;
  /** When it arrived, on the injected clock. */
  at: number;
  /** Held back by do-not-disturb: in the history, never shown. */
  held: boolean;
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
  Partial<Pick<Notice, "id" | "body" | "level">>;

export class Notifications {
  readonly #clock: Clock;
  readonly #render: (notice: Notice | null) => void;
  #settings: NotifySettings = DEFAULT_NOTIFY;
  #history: Notice[] = [];
  #current: Notice | null = null;
  #until = Number.POSITIVE_INFINITY;
  #cancel: (() => void) | undefined;
  #nextId = 1;

  constructor(clock: Clock, render: (notice: Notice | null) => void) {
    this.#clock = clock;
    this.#render = render;
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
      level,
      at: this.#clock.now(),
      held,
    };
    this.#history.push(notice);
    this.#trim();
    if (!held) this.#show(notice);
    return notice;
  }

  /** The notice showing now, or null. */
  current(): Notice | null {
    return this.#current;
  }

  dismiss(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    if (this.#current === null) return;
    this.#current = null;
    this.#render(null);
  }

  /** Newest first. */
  history(): Notice[] {
    return [...this.#history].reverse();
  }

  clear(): void {
    this.#history = [];
  }

  dispose(): void {
    this.#cancel?.();
  }

  #show(notice: Notice): void {
    this.#cancel?.();
    this.#current = notice;
    this.#render(notice);
    const duration = this.#settings.durations[notice.level];
    this.#until = duration > 0 ? notice.at + duration : Number.POSITIVE_INFINITY;
    if (duration <= 0) return;
    const step = (now: number) => {
      if (now >= this.#until) this.dismiss();
      else this.#cancel = this.#clock.requestFrame(step);
    };
    this.#cancel = this.#clock.requestFrame(step);
  }

  #trim(): void {
    const extra = this.#history.length - Math.max(0, this.#settings.history);
    if (extra > 0) this.#history.splice(0, extra);
  }
}

/** The status line text for a notice: "Title — body". */
export function noticeText(notice: Notice): string {
  return notice.body ? `${notice.title} — ${notice.body}` : notice.title;
}
