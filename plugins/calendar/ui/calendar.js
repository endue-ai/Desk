// The calendar plugin without its DOM: it keeps each open iCalendar file's document and model,
// draws the view in the person's mode and week, answers the person's commands, and joins the parts
// that do the rest: files.js (the desk's file requests), editing.js (the editor), agent.js (commands
// for agents) and remind.js (reminders). It talks only to ctx and a view, so the SDK's test host
// runs it with a recording view.
import { createAgentCommands } from "./agent.js";
import { emptyDocument } from "./calendar/edit.js";
import { localeWeekStart, MODES, span, step } from "./calendar/layout.js";
import { buildModel, occurrences } from "./calendar/model.js";
import { createEditing } from "./editing.js";
import { createFiles, nameOf } from "./files.js";
import { heading } from "./format.js";
import { formatComponent, parse } from "./ical/component.js";
import { DAY } from "./ical/values.js";
import { displayZone } from "./ical/zones.js";
import { createReminders } from "./remind.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./calendar/model.js").Model} Model
 * @typedef {import("./calendar/model.js").Occurrence} Occurrence
 * @typedef {import("./calendar/edit.js").Scope} Scope
 * @typedef {import("./calendar/write.js").EventFields} EventFields
 * @typedef {import("./calendar/layout.js").Mode} Mode
 * @typedef {import("./ical/component.js").Document} Document
 *
 * @typedef {object} Cal an open calendar file
 * @property {string} buffer
 * @property {string} path
 * @property {string} name
 * @property {string} text the file as last read or saved
 * @property {Document} doc
 * @property {Model} model
 * @property {boolean} modified
 * @property {boolean} reported whether the desk heard about the unsaved changes
 * @property {boolean} readOnly the file holds text but no VCALENDAR: saving would lose it
 * @property {string} [watchId]
 *
 * @typedef {object} CalendarState what the view draws
 * @property {{ name: string, path: string, modified: boolean, readOnly: boolean, problems: string[] } | null} calendar
 * @property {Mode} mode
 * @property {number} anchor @property {number} today @property {number} weekStart
 * @property {{ from: number, to: number }} span @property {string} title
 * @property {Occurrence[]} occurrences @property {number} now the wall time now
 * @property {number} dayStart the hour the week and day views open at
 * @property {string} locale
 *
 * @typedef {object} EditorState what the editor shows
 * @property {"new" | "edit"} kind @property {EventFields} fields
 * @property {boolean} recurring @property {string} zone the display zone
 *
 * @typedef {object} View
 * @property {(state: CalendarState) => void} render
 * @property {(state: EditorState | null) => void} editor
 * @property {(text: string) => void} status
 * @property {() => void} focus
 *
 * @typedef {object} Options
 * @property {() => number} [now]
 * @property {() => string} [uid]
 * @property {string} [locale]
 * @property {(run: () => void, ms: number) => unknown} [setTimer]
 * @property {(timer: unknown) => void} [clearTimer]
 */

export const DEFAULT_FILE = "~/Calendar/calendar.ics";
const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** A random UUID; crypto.randomUUID needs a secure context, so there is a fallback. */
const randomId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** The message of anything thrown. */
const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {Options} [options]
 */
export function createCalendar(ctx, view, options = {}) {
  const { bridge, commands } = ctx;
  const now = options.now ?? (() => Date.now());
  const uid = options.uid ?? (() => `${randomId()}@endue.ai`);
  const locale = options.locale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  /** @type {Record<string, unknown>} */
  let settings = {};
  const setting = (/** @type {string} */ key, /** @type {unknown} */ fallback) =>
    settings[`endue.calendar.${key}`] ?? fallback;

  let display = displayZone(undefined);
  let weekStart = localeWeekStart(locale);
  const saved = /** @type {{ mode?: Mode, anchor?: number } | undefined} */ (ctx.state.get());
  /** @type {Mode} */
  let mode = saved?.mode && MODES.includes(saved.mode) ? saved.mode : "month";
  const todayOf = () => Math.floor((now() + display.offset(now())) / DAY);
  let anchor = saved?.anchor ?? todayOf();

  /** @type {Map<string, Cal>} */
  const calendars = new Map();
  /** @type {string | null} */
  let shown = null;
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.status(text);
  };
  const current = () => (shown === null ? undefined : calendars.get(shown));
  const remember = () =>
    ctx.state.set({ .../** @type {object} */ (ctx.state.get() ?? {}), mode, anchor });

  /** The occurrences a view of a calendar covers. */
  const visible = (/** @type {Cal} */ cal) => {
    const range = span(mode, anchor, weekStart);
    return occurrences(cal.model, display.toUtc(range.from * DAY), display.toUtc(range.to * DAY));
  };

  const render = () => {
    const cal = current();
    const range = span(mode, anchor, weekStart);
    const at = now();
    view.render({
      calendar: cal
        ? {
            name: cal.model.name,
            path: cal.path,
            modified: cal.modified,
            readOnly: cal.readOnly,
            problems: cal.model.problems,
          }
        : null,
      mode,
      anchor,
      today: todayOf(),
      weekStart,
      span: range,
      title: heading(locale, mode, range, anchor),
      occurrences: cal ? visible(cal) : [],
      now: at + display.offset(at),
      dayStart: Number(setting("day-start", 8)),
      locale,
    });
  };

  /** Read a file into a calendar; an empty file is a new, empty calendar. */
  const load = (/** @type {Cal} */ cal, /** @type {string} */ text) => {
    const doc = text.trim() === "" ? emptyDocument() : parse(text);
    cal.text = text;
    cal.doc = doc;
    cal.readOnly = doc.calendars.length === 0;
    cal.model = buildModel(doc, display, nameOf(cal.path).replace(/\.[^.]+$/, ""));
    reminders.changed();
  };

  const writable = (/** @type {Cal} */ cal) => {
    if (cal.readOnly) throw new Error(`${cal.name} is not an iCalendar file; it opens read-only.`);
    return cal;
  };

  /** Answer a request or command; a failure is said on the status line and ends it. */
  const answer = (/** @type {string} */ name, /** @type {(args: unknown) => unknown} */ handler) =>
    commands.on(name, async (args) => {
      try {
        const result = await handler(args);
        if (name.startsWith("desk.")) say("");
        return result;
      } catch (error) {
        say(messageOf(error));
        throw error;
      }
    });

  const files = createFiles(ctx, {
    calendars,
    shown: () => shown,
    show: (buffer) => {
      shown = buffer;
      render();
      if (buffer !== null) view.focus();
      reminders.changed();
    },
    render,
    load,
    writable,
    closed: (buffer) => {
      editing.closed(buffer);
      reminders.changed();
    },
    answer,
  });

  /** Put a changed document in place: the calendar is unsaved until the desk saves it. */
  const change = (
    /** @type {Cal} */ cal,
    /** @type {Document} */ doc,
    /** @type {string} */ message,
  ) => {
    cal.doc = doc;
    cal.model = buildModel(doc, display, cal.model.name);
    cal.modified = true;
    files.report(cal);
    reminders.changed();
    if (cal.buffer === shown) render();
    say(message);
  };

  const editing = createEditing({
    calendars,
    current,
    visible,
    writable,
    change,
    show: (state) => view.editor(state),
    display: () => display,
    now,
    uid,
    today: todayOf,
    defaultDay: () => (mode === "month" || mode === "agenda" ? anchor : todayOf()),
    reveal: (day) => {
      anchor = day;
      remember();
    },
    setting,
  });

  // Moving around.
  const go = (/** @type {number} */ day) => {
    anchor = day;
    remember();
    render();
  };
  const show = (/** @type {Mode} */ next) => {
    mode = next;
    remember();
    render();
  };

  /** Open the calendar file the settings name, making an empty one when there is none. */
  const openDefault = async () => {
    const path = String(setting("file", DEFAULT_FILE));
    try {
      await files.read(path);
    } catch (error) {
      if (!/: not_found\.$/.test(messageOf(error))) throw error;
      const empty = emptyDocument("Calendar").calendars.map(formatComponent).join("");
      await files.write(path, empty, true);
    }
    return commands.run("desk.files.open", { path });
  };

  /** A day from words: 2026-11-03, 2026-11, today, tomorrow, yesterday. */
  const dayFrom = (/** @type {string} */ words) => {
    const text = words.trim().toLowerCase();
    const relative = { today: 0, tomorrow: 1, yesterday: -1 }[text];
    if (relative !== undefined) return todayOf() + relative;
    const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
    if (!match) return undefined;
    const day = Math.floor(
      Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3] ?? 1)) / DAY,
    );
    return Number.isFinite(day) ? day : undefined;
  };

  /** Go to the day the person names, asking through the palette when no date is given. */
  const askDate = async (/** @type {unknown} */ given) => {
    const words =
      typeof given === "string"
        ? given
        : await commands.run("desk.palette.pick", {
            title: "Go to a date",
            items: [
              { id: "today", label: "Today" },
              { id: "tomorrow", label: "Tomorrow" },
            ],
            free: true,
            placeholder: "2026-11-03",
          });
    if (typeof words !== "string" || words === "") return null;
    const day = dayFrom(words);
    if (day === undefined) throw new Error(`"${words}" is not a date; write it as 2026-11-03.`);
    go(day);
    return null;
  };

  /** Run an action from the view; a failure is said on the status line. */
  const safely = (/** @type {() => unknown} */ action) => {
    try {
      action();
    } catch (error) {
      say(messageOf(error));
    }
  };

  const reminders = createReminders(ctx, {
    calendars: () => [...calendars.values()].map((c) => c.model),
    now,
    locale,
    enabled: () => setting("reminders", true) !== false,
    ...(options.setTimer ? { setTimer: options.setTimer } : {}),
    ...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
  });

  // The person's commands (contributes.commands).
  answer("endue.calendar.open", () => openDefault());
  answer("endue.calendar.today", () => go(todayOf()));
  answer("endue.calendar.next", () => go(step(mode, anchor, 1)));
  answer("endue.calendar.previous", () => go(step(mode, anchor, -1)));
  for (const each of MODES) answer(`endue.calendar.${each}`, () => show(each));
  answer("endue.calendar.new", () => editing.compose());
  answer("endue.calendar.goto", (args) =>
    askDate(/** @type {{ date?: unknown } | undefined} */ (args)?.date),
  );

  createAgentCommands(ctx, {
    calendars: () => [...calendars.values()],
    shown: current,
    display: () => display,
    now,
    uid,
    readDefault: async () => {
      const path = String(setting("file", DEFAULT_FILE));
      const cal = /** @type {Cal} */ ({ buffer: "", path, name: nameOf(path), modified: false });
      load(cal, await files.read(path));
      return cal;
    },
    openDefault,
    change,
    writable,
  });

  /** Settings from init.yaml; the view draws once with defaults and again when they arrive. */
  const configure = (/** @type {Record<string, unknown>} */ values) => {
    settings = values;
    display = displayZone(String(setting("time-zone", "")) || undefined);
    const named = WEEKDAY_NAMES.indexOf(String(setting("week-start", "locale")));
    weekStart = named >= 0 ? named : localeWeekStart(locale);
    const preferred = /** @type {Mode} */ (setting("view", "month"));
    if (!saved?.mode && MODES.includes(preferred)) mode = preferred;
    if (saved?.anchor === undefined) anchor = todayOf();
    for (const cal of calendars.values()) cal.model = buildModel(cal.doc, display, cal.model.name);
    render();
  };
  render();
  bridge.call("init.get", {}).then(
    (init) => configure(/** @type {Record<string, unknown>} */ (init.settings ?? {})),
    () => {},
  );

  return {
    /** For the view: move, switch views, open the editor, save or delete, close it. */
    previous: () => go(step(mode, anchor, -1)),
    next: () => go(step(mode, anchor, 1)),
    today: () => go(todayOf()),
    show: (/** @type {Mode} */ next) => show(next),
    goto: (/** @type {number} */ day) => go(day),
    ask: () => {
      askDate(undefined).catch((error) => say(messageOf(error)));
    },
    compose: (/** @type {{ day?: number, minute?: number, allDay?: boolean }} */ at) =>
      safely(() => editing.compose(at)),
    edit: (/** @type {string} */ id) => safely(() => editing.edit(id)),
    save: (/** @type {EventFields} */ fields, /** @type {Scope} */ scope) =>
      safely(() => editing.save(fields, scope)),
    remove: (/** @type {Scope} */ scope) => safely(() => editing.remove(scope)),
    close: () => editing.close(),
    /** Stop the reminder timer. */
    dispose: () => reminders.dispose(),
  };
}
