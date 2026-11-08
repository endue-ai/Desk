// The event editor: a modal dialog with the title, all-day, start and end, time zone, repeat,
// reminder, place, notes and busy or free. For an event of a series, Save and Delete first ask which
// events they are for. Fields are checked before anything is saved, and a field in error says why
// next to itself (aria-invalid, aria-describedby).
import { presetOf, REMINDERS, repeatPresets } from "./choices.js";
import { h } from "./dom.js";
import { parseRule } from "./ical/rrule.js";
import { DAY } from "./ical/values.js";
import { ianaZone } from "./ical/zones.js";

/**
 * @typedef {import("./calendar.js").EditorState} EditorState
 * @typedef {import("./calendar/write.js").EventFields} EventFields
 * @typedef {import("./calendar/edit.js").Scope} Scope
 * @typedef {{ save(fields: EventFields, scope: Scope): void, remove(scope: Scope): void, close(): void }} Actions
 */

const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
const dateValue = (/** @type {number} */ wall) => {
  const d = new Date(wall);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const timeValue = (/** @type {number} */ wall) => {
  const d = new Date(wall);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
/** A wall time from a date field and a time field; NaN when either does not read. */
const wallFrom = (/** @type {string} */ date, /** @type {string} */ time) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!day || !clock) return Number.NaN;
  return Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
};

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createEditor(doc, actions) {
  const dialog = /** @type {HTMLDialogElement} */ (doc.getElementById("editor"));
  const form = /** @type {HTMLFormElement} */ (dialog.querySelector("form"));
  const field = (/** @type {string} */ name) =>
    /** @type {HTMLInputElement & HTMLSelectElement & HTMLTextAreaElement} */ (
      form.elements.namedItem(name)
    );
  const heading = /** @type {HTMLElement} */ (doc.getElementById("editor-title"));
  const scopes = /** @type {HTMLElement} */ (doc.getElementById("editor-scope"));
  const remove = /** @type {HTMLButtonElement} */ (doc.getElementById("editor-delete"));
  const zones = /** @type {HTMLDataListElement} */ (doc.getElementById("zones"));
  /** @type {EditorState | null} */
  let state = null;
  /** @type {string | null} the custom rule as written, kept when the person leaves it alone */
  let custom = null;

  const errorOf = (/** @type {string} */ name) =>
    /** @type {HTMLElement} */ (doc.getElementById(`${name}-error`));
  const setError = (/** @type {string} */ name, /** @type {string} */ message) => {
    const input = field(name);
    errorOf(name).textContent = message;
    errorOf(name).hidden = !message;
    if (message) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  };

  /** Fill the repeat choices for the start date, keeping the choice. */
  const repeats = (/** @type {number} */ start, /** @type {string} */ chosen) => {
    const select = field("repeat");
    select.replaceChildren(
      ...repeatPresets(start).map((p) => h(doc, "option", { value: p.id, text: p.label })),
      h(doc, "option", { value: "custom", text: "Custom rule…" }),
    );
    select.value = chosen;
    field("rrule").hidden = chosen !== "custom";
    /** @type {HTMLElement} */ (doc.getElementById("rrule-label")).hidden = chosen !== "custom";
  };

  const reminders = (
    /** @type {boolean} */ allDay,
    /** @type {number | null | undefined} */ chosen,
  ) => {
    const select = field("reminder");
    const list = allDay ? REMINDERS.allDay : REMINDERS.timed;
    const known = chosen === null || chosen === undefined || list.some((r) => r.minutes === chosen);
    const options = [
      h(doc, "option", { value: "none", text: "No reminder" }),
      ...list.map((r) => h(doc, "option", { value: String(r.minutes), text: r.label })),
    ];
    // A reminder the list does not offer stays offered, and alarms it cannot say are kept.
    if (!known)
      options.push(h(doc, "option", { value: String(chosen), text: `${chosen} minutes before` }));
    if (chosen === undefined)
      options.push(h(doc, "option", { value: "keep", text: "Keep its alarms" }));
    select.replaceChildren(...options);
    select.value = chosen === undefined ? "keep" : chosen === null ? "none" : String(chosen);
  };

  const allDayChanged = () => {
    const allDay = field("allDay").checked;
    for (const name of ["startTime", "endTime", "zone"]) {
      field(name).hidden = allDay;
      field(name).disabled = allDay;
    }
    /** @type {HTMLElement} */ (doc.getElementById("zone-label")).hidden = allDay;
    reminders(allDay, field("reminder").value === "keep" ? undefined : null);
  };

  field("allDay").addEventListener("change", allDayChanged);
  field("repeat").addEventListener("change", () => {
    const chosen = field("repeat").value;
    field("rrule").hidden = chosen !== "custom";
    /** @type {HTMLElement} */ (doc.getElementById("rrule-label")).hidden = chosen !== "custom";
    if (chosen === "custom" && !field("rrule").value)
      field("rrule").value = custom ?? "FREQ=WEEKLY";
  });
  field("startDate").addEventListener("change", () => {
    const start = wallFrom(field("startDate").value, "00:00");
    if (!Number.isNaN(start)) repeats(start, field("repeat").value);
  });

  /** Read the form; undefined when a field is in error (each one says why). */
  const read = () => {
    const allDay = field("allDay").checked;
    const start = wallFrom(field("startDate").value, allDay ? "00:00" : field("startTime").value);
    let end = wallFrom(field("endDate").value, allDay ? "00:00" : field("endTime").value);
    if (allDay) end += DAY;
    const zone = allDay ? "" : field("zone").value.trim();
    const repeat = field("repeat").value;
    const rule =
      repeat === "custom"
        ? field("rrule")
            .value.trim()
            .replace(/^RRULE:/i, "")
        : null;
    setError("startDate", Number.isNaN(start) ? "Enter a start date and time." : "");
    setError(
      "endDate",
      Number.isNaN(end)
        ? "Enter an end date and time."
        : end < start
          ? "The event ends before it starts."
          : "",
    );
    setError(
      "zone",
      zone && zone !== "UTC" && !ianaZone(zone) ? `${zone} is not a time zone.` : "",
    );
    const parsed = rule ? parseRule(rule) : undefined;
    setError(
      "rrule",
      repeat === "custom" && (!rule || (parsed && "error" in parsed))
        ? `Not a repeat rule${parsed && "error" in parsed ? `: ${parsed.error}` : ""}.`
        : "",
    );
    const invalid = form.querySelector('[aria-invalid="true"]');
    if (invalid) {
      /** @type {HTMLElement} */ (invalid).focus();
      return undefined;
    }
    const preset = repeatPresets(start).find((p) => p.id === repeat);
    const reminder = field("reminder").value;
    /** @type {EventFields} */
    const fields = {
      title: field("title").value,
      allDay,
      start,
      end,
      zone,
      location: field("location").value,
      description: field("description").value,
      rrule: repeat === "custom" ? rule : (preset?.rrule ?? null),
      free: field("free").value === "free",
      ...(reminder === "keep" ? {} : { reminder: reminder === "none" ? null : Number(reminder) }),
    };
    // A rule the person did not touch stays exactly as it was written.
    const sameDay = state && Math.floor(state.fields.start / DAY) === Math.floor(start / DAY);
    if (
      state &&
      sameDay &&
      repeat !== "custom" &&
      presetOf(state.fields.rrule, state.fields.start) === repeat
    )
      fields.rrule = state.fields.rrule ?? null;
    return fields;
  };

  const scope = () =>
    /** @type {Scope} */ (
      /** @type {HTMLInputElement | null} */ (form.querySelector('input[name="scope"]:checked'))
        ?.value ?? "all"
    );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = read();
    if (fields) actions.save(fields, state?.recurring ? scope() : "all");
  });
  remove.addEventListener("click", () => actions.remove(state?.recurring ? scope() : "all"));
  /** @type {HTMLElement} */ (doc.getElementById("editor-cancel")).addEventListener("click", () =>
    actions.close(),
  );
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    actions.close();
  });

  let zonesFilled = false;
  const fillZones = () => {
    if (zonesFilled) return;
    zonesFilled = true;
    const names =
      typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    zones.replaceChildren(...["UTC", ...names].map((z) => h(doc, "option", { value: z })));
  };

  return {
    /** Show the editor for a new or an existing event, or close it (null). */
    open(/** @type {EditorState | null} */ next) {
      state = next;
      if (!next) {
        if (dialog.open) dialog.close();
        return;
      }
      fillZones();
      const { fields } = next;
      heading.textContent = next.kind === "new" ? "New event" : "Edit event";
      remove.hidden = next.kind === "new";
      scopes.hidden = !next.recurring;
      for (const name of ["startDate", "endDate", "zone", "rrule"]) setError(name, "");
      field("title").value = fields.title;
      field("allDay").checked = fields.allDay;
      field("startDate").value = dateValue(fields.start);
      field("startTime").value = timeValue(fields.start);
      // An all-day event's end is the day after its last day; the field shows the last day.
      field("endDate").value = dateValue(fields.allDay ? fields.end - DAY : fields.end);
      field("endTime").value = timeValue(fields.end);
      field("zone").value = fields.zone || (fields.allDay ? next.zone : "");
      field("zone").placeholder = "Floating (no time zone)";
      field("location").value = fields.location ?? "";
      field("description").value = fields.description ?? "";
      field("free").value = fields.free ? "free" : "busy";
      const preset = presetOf(fields.rrule, fields.start);
      custom = preset === "custom" ? (fields.rrule ?? null) : null;
      field("rrule").value = custom ?? "";
      repeats(fields.start, preset);
      allDayChanged();
      reminders(fields.allDay, fields.reminder);
      // "This event" is the safe default for a change to one event of a series.
      const one = /** @type {HTMLInputElement | null} */ (
        form.querySelector('input[name="scope"][value="one"]')
      );
      if (one) one.checked = true;
      if (!dialog.open) dialog.showModal();
      field("title").focus();
    },
  };
}
