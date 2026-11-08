// The editor's side of the calendar plugin: opening it on a new event (at a time on a day, or all
// day) or on an event the view shows, and turning its Save and Delete into changes of the document,
// for one event or, in a series, for the scope the person chose.
import { createEvent, deleteEvent, fieldsOf, updateEvent } from "./calendar/edit.js";
import { DAY, HOUR, MINUTE } from "./ical/values.js";

/**
 * @typedef {import("./calendar.js").Cal} Cal
 * @typedef {import("./calendar.js").EditorState} EditorState
 * @typedef {import("./calendar/model.js").Occurrence} Occurrence
 * @typedef {import("./calendar/edit.js").Scope} Scope
 * @typedef {import("./calendar/write.js").EventFields} EventFields
 * @typedef {import("./ical/zones.js").Zone} Zone
 * @typedef {import("./ical/component.js").Document} Document
 *
 * @typedef {object} Host
 * @property {Map<string, Cal>} calendars
 * @property {() => Cal | undefined} current the calendar on screen
 * @property {(cal: Cal) => Occurrence[]} visible the occurrences the view shows
 * @property {(cal: Cal) => Cal} writable
 * @property {(cal: Cal, doc: Document, message: string) => void} change
 * @property {(state: EditorState | null) => void} show draw the editor, or close it
 * @property {() => Zone} display
 * @property {() => number} now
 * @property {() => string} uid
 * @property {() => number} today
 * @property {() => number} defaultDay the day a new event goes on when none is named
 * @property {(day: number) => void} reveal move the view to a day without drawing it
 * @property {(key: string, fallback: unknown) => unknown} setting
 */

/** @param {Host} host */
export function createEditing(host) {
  /** @type {{ buffer: string, occurrence?: Occurrence } | null} */
  let editing = null;

  const close = () => {
    editing = null;
    host.show(null);
  };

  /** Open the editor on a new event: at a time on a day, or all day. */
  const compose = (/** @type {{ day?: number, minute?: number, allDay?: boolean }} */ at = {}) => {
    const cal = host.current();
    if (!cal) throw new Error("Open a calendar first.");
    host.writable(cal);
    const display = host.display();
    const day = at.day ?? host.defaultDay();
    const allDay = at.allDay ?? false;
    const nowWall = host.now() + display.offset(host.now());
    // Today the next whole hour; another day 09:00.
    const minute =
      at.minute ?? (day === host.today() ? Math.ceil((nowWall - day * DAY) / HOUR) * 60 : 9 * 60);
    const start = day * DAY + Math.min(minute, 23 * 60) * MINUTE;
    const length = Number(host.setting("event-minutes", 60)) * MINUTE;
    editing = { buffer: cal.buffer };
    host.show({
      kind: "new",
      fields: {
        title: "",
        allDay,
        start: allDay ? day * DAY : start,
        end: allDay ? (day + 1) * DAY : start + length,
        zone: allDay ? "" : display.id,
        location: "",
        description: "",
        rrule: null,
        reminder: allDay ? null : Number(host.setting("reminder-minutes", 10)),
        free: allDay,
      },
      recurring: false,
      zone: display.id,
    });
  };

  /** Open the editor on an event the view shows. */
  const edit = (/** @type {string} */ id) => {
    const cal = host.current();
    const occ = cal && host.visible(cal).find((o) => o.id === id);
    if (!cal || !occ) throw new Error("That event is no longer on the calendar.");
    editing = { buffer: cal.buffer, occurrence: occ };
    const display = host.display();
    host.show({
      kind: "edit",
      fields: fieldsOf(occ, display),
      recurring: occ.recurring,
      zone: display.id,
    });
  };

  const context = () => ({ now: host.now(), uid: host.uid, display: host.display() });

  /** The editor's Save: a new event, or a change in the scope the person chose. */
  const save = (/** @type {EventFields} */ fields, /** @type {Scope} */ scope = "all") => {
    const cal = editing && host.calendars.get(editing.buffer);
    if (!editing || !cal) throw new Error("The calendar was closed.");
    host.writable(cal);
    if (fields.end < fields.start) throw new Error("The event ends before it starts.");
    const title = fields.title.trim() || "(No title)";
    const occ = editing.occurrence;
    const doc = occ
      ? updateEvent(cal.doc, occ, { ...fields, title }, scope, context())
      : createEvent(cal.doc, { ...fields, title }, context()).doc;
    close();
    if (!occ) host.reveal(Math.floor(fields.start / DAY));
    host.change(cal, doc, occ ? `Changed ${title}.` : `Added ${title}.`);
  };

  const remove = (/** @type {Scope} */ scope = "all") => {
    const cal = editing && host.calendars.get(editing.buffer);
    const occ = editing?.occurrence;
    if (!cal || !occ) throw new Error("There is no event to delete.");
    host.writable(cal);
    const doc = deleteEvent(cal.doc, occ, scope, context());
    close();
    host.change(cal, doc, `Deleted ${occ.title}.`);
  };

  return {
    compose,
    edit,
    save,
    remove,
    close,
    /** A buffer closed: an editor open on it closes too. */
    closed(/** @type {string} */ buffer) {
      if (editing?.buffer === buffer) close();
    },
  };
}
