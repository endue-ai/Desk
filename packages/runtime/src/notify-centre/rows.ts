/**
 * The notification centre's rows (#307): the history under Today and Earlier (the local calendar
 * day of the wall clock), newest first, and one row a notice: its plugin's name, its time, its
 * title and body, its actions, and a Dismiss. A running plugin's notice opens what it is about
 * (ADR 0113): its words are a button, as its text is on the status line.
 */
import type { Language } from "@endue-ai/bridge";
import type { Notice, NoticeAction } from "../notify";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import { centreText } from "./copy";

export type GroupKey = "today" | "earlier";

export interface Group {
  key: GroupKey;
  notices: Notice[];
}

const dayOf = (time: number) => new Date(time).toDateString();

/** The history (newest first) by day; a notice of no known time is one of the earlier ones. */
export function groupsOf(history: readonly Notice[], now: number): Group[] {
  const today: Notice[] = [];
  const earlier: Notice[] = [];
  for (const notice of history) {
    const of = notice.time !== undefined && dayOf(notice.time) === dayOf(now) ? today : earlier;
    of.push(notice);
  }
  const groups: Group[] = [
    { key: "today", notices: today },
    { key: "earlier", notices: earlier },
  ];
  return groups.filter((group) => group.notices.length > 0);
}

const HOURS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };

/** "09:40" today; "Nov 20, 17:30" on an earlier day, with its year when that is another. */
export function timeLabel(lang: Language, time: number, today: boolean, now: number): string {
  if (today) return new Intl.DateTimeFormat(lang, HOURS).format(time);
  const year = new Date(time).getFullYear() !== new Date(now).getFullYear();
  const day: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return new Intl.DateTimeFormat(lang, {
    ...(year ? { year: "numeric" } : {}),
    ...day,
    ...HOURS,
  }).format(time);
}

/** What a row needs of the centre. */
export interface RowContext {
  lang: Language;
  now: number;
  /** A plugin's name for people: plugin.list's. */
  pluginName(caller: string): string;
  /** Whether a notice has a running plugin to open. */
  opens(notice: Notice): boolean;
  open(notice: Notice): void;
  act(notice: Notice, action: NoticeAction): void;
  dismiss(notice: Notice): void;
}

/** One notice's row, under group `key`. */
export function rowOf(notice: Notice, key: GroupKey, ctx: RowContext): HTMLLIElement {
  const { lang } = ctx;
  const name = notice.caller === "desk" ? centreText(lang, "desk") : ctx.pluginName(notice.caller);
  const when = notice.time;
  const meta = h(
    "span",
    { class: "desk-notify-meta" },
    h("span", { class: "desk-notify-plugin" }, name),
    when === undefined
      ? null
      : h(
          "time",
          { datetime: new Date(when).toISOString() },
          timeLabel(lang, when, key === "today", ctx.now),
        ),
  );
  const words = [
    meta,
    h("span", { class: "desk-notify-row-title" }, notice.title),
    notice.body ? h("span", { class: "desk-notify-row-body" }, notice.body) : null,
  ];
  const text = ctx.opens(notice)
    ? h(
        "button",
        {
          type: "button",
          class: "menu-item desk-notify-text desk-notify-open",
          "data-key": `open-${notice.id}`,
          onClick: () => ctx.open(notice),
        },
        words,
      )
    : h("div", { class: "desk-notify-text" }, words);
  const actions = (notice.actions ?? []).map((action, i) =>
    h(
      "button",
      {
        type: "button",
        class: "btn btn-xs btn-outline desk-notify-action",
        "data-key": `action-${notice.id}-${i}`,
        onClick: () => ctx.act(notice, action),
      },
      action.label,
    ),
  );
  const dismiss = h(
    "button",
    {
      type: "button",
      class: "icon-button desk-notify-dismiss",
      "aria-label": centreText(lang, "dismiss"),
      title: centreText(lang, "dismiss"),
      onClick: () => ctx.dismiss(notice),
    },
    icon("close", 14),
  );
  return h(
    "li",
    {
      role: "listitem",
      class: "desk-notify-row",
      tabindex: "-1",
      "data-id": notice.id,
      "data-level": notice.level,
    },
    text,
    actions.length > 0 ? h("div", { class: "desk-notify-actions" }, actions) : null,
    dismiss,
  );
}
