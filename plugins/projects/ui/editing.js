// Changing work: moving it to another status, rescheduling it, giving it a priority or a person.
// Every change shows at once, goes to the connector's command (`<connector>.task.move` or
// `.task.update`), and is undone when the connector refuses; the connector's next sync brings the
// work as its source now has it. Drops on the board, the swimlanes and the calendar, and the
// keyboard's Shift+arrows, arrive here.

import { actionId } from "./actions.js";
import { categoryOfName } from "./adapters/common.js";
import { laneChange, statusFor } from "./layout/board.js";
import { dateOfDay, dayOf } from "./layout/dates.js";
import { FIELDS, sourceTitle, statusKey } from "./model.js";

/**
 * @typedef {import("./adapters/common.js").Work} Work
 * @typedef {import("./adapters/common.js").Category} Category
 * @typedef {import("./adapters/common.js").Person} Person
 * @typedef {import("./state.js").State} State
 * @typedef {import("./state.js").Action} Action
 * @typedef {{ due?: string | null, start?: string | null, priority?: number | null, assignee?: Person | null }} Fields
 * @typedef {{
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   state: State, screen(): import("./present.js").Screen,
 *   put(key: string, work: Work | null): void, draw(): void,
 *   say(text: string): void, fail(error: unknown): void,
 * }} Deps
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How the status line names a piece of work. */
export const label = (/** @type {Work} */ w) => w.ref || `“${w.title}”`;

/** The fields an update may carry, checked; anything else is refused with a sentence. @returns {Fields} */
export function checkFields(/** @type {Record<string, unknown>} */ a) {
  /** @type {Fields} */
  const out = {};
  for (const name of /** @type {const} */ (["due", "start"])) {
    if (!(name in a)) continue;
    const value = a[name];
    if (
      value !== null &&
      (typeof value !== "string" || !DATE.test(value) || Number.isNaN(dayOf(value)))
    )
      throw new Error(`${name} is a date (YYYY-MM-DD) or null.`);
    out[name] = value;
  }
  if ("priority" in a) {
    const p = a.priority;
    if (p !== null && !(Number.isInteger(p) && Number(p) >= 1 && Number(p) <= 4))
      throw new Error("priority is 1 (urgent) to 4 (low), or null.");
    out.priority = /** @type {number | null} */ (p);
  }
  if ("assignee" in a) {
    const who = a.assignee;
    if (typeof who === "string" && who.trim())
      out.assignee = who.includes("@") ? { email: who.trim() } : { name: who.trim() };
    else if (who === null) out.assignee = null;
    else if (
      who &&
      typeof who === "object" &&
      (typeof (/** @type {Person} */ (who).name) === "string" ||
        typeof (/** @type {Person} */ (who).email) === "string")
    )
      out.assignee = /** @type {Person} */ (who);
    else throw new Error("assignee is a name, an email, { name, email } or null.");
  }
  if (Object.keys(out).length === 0)
    throw new Error("Change what? due, start, priority or assignee.");
  return out;
}

/** The work with the fields laid over it, as the screen shows it until the connector syncs. */
function applied(/** @type {Work} */ work, /** @type {Fields} */ fields) {
  /** @type {Record<string, unknown>} */
  const out = { ...work };
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) delete out[name];
    else out[name] = value;
  }
  if (fields.priority !== undefined) {
    out.priority = fields.priority;
    delete out.priorityName;
  }
  return /** @type {Work} */ (out);
}

/** @param {Deps} deps */
export function createEditing({ actions, state: s, screen, put, draw, say, fail }) {
  const can = (/** @type {Work} */ w, /** @type {Action} */ action) =>
    (s.available[w.source.connector] ?? []).includes(action);
  const refuse = (/** @type {Work} */ w, /** @type {Action} */ action) => {
    if (!can(w, action))
      throw new Error(
        `${sourceTitle(w)} cannot ${action} tasks: it provides no ${actionId(w.source.connector, action)}.`,
      );
  };

  /**
   * Run an action with the change already on screen; undo it when refused.
   * @param {Work} work @param {Work} after @param {Action} action
   * @param {Record<string, unknown>} args @param {string} done
   */
  const change = async (work, after, action, args, done) => {
    put(work.key, after);
    draw();
    try {
      await actions.run(work.source.connector, action, {
        instance: work.source.instance,
        id: work.id,
        ...args,
      });
      say(done);
    } catch (error) {
      put(work.key, work);
      draw();
      fail(error);
      throw error;
    }
  };

  /** The category a status has: as the work that has it says, else from its name. @returns {Category} */
  const categoryFor = (/** @type {string} */ status, /** @type {string} */ connector) => {
    const key = statusKey(status);
    const same = s.works.filter((w) => statusKey(w.status) === key);
    const seen = same.find((w) => w.source.connector === connector) ?? same[0];
    return seen?.category ?? /** @type {Category} */ (categoryOfName(status));
  };

  /** Move a piece of work to a status, as its source names it. */
  const move = async (
    /** @type {Work} */ work,
    /** @type {string} */ status,
    /** @type {Category} */ category,
  ) => {
    if (!status.trim()) throw new Error("Move to which status?");
    if (statusKey(status) === statusKey(work.status)) return work.status;
    refuse(work, "move");
    const after = {
      ...work,
      status,
      category: category ?? categoryFor(status, work.source.connector),
    };
    await change(work, after, "move", { status }, `Moved ${label(work)} to ${status}.`);
    return status;
  };

  /** Change a piece of work's dates, priority or person. */
  const update = async (/** @type {Work} */ work, /** @type {Record<string, unknown>} */ raw) => {
    const fields = checkFields(raw);
    refuse(work, "update");
    await change(work, applied(work, fields), "update", fields, `Updated ${label(work)}.`);
    return fields;
  };

  /** A calendar drop: the work's day moves there, and its start with it so it keeps its length. */
  const reschedule = (/** @type {Work} */ work, /** @type {string} */ date) => {
    if (!work.due) return work.start === date ? undefined : update(work, { start: date });
    if (work.due === date) return undefined;
    const delta = dayOf(date) - dayOf(work.due);
    const start = work.start ? { start: dateOfDay(dayOf(work.start) + delta) } : {};
    return update(work, { due: date, ...start });
  };

  /**
   * A card dropped on a column (and a lane), or on a calendar day.
   * @param {{ key: string, column?: number, lane?: number, date?: string }} at
   */
  const drop = async ({ key, column, lane, date }) => {
    const work = s.works.find((w) => w.key === key);
    if (!work) return;
    const { body } = screen();
    try {
      if (date !== undefined) {
        if (body.kind === "calendar") await reschedule(work, date);
        return;
      }
      if (body.kind !== "kanban" && body.kind !== "swimlane") return;
      const target = column === undefined ? undefined : body.columns[column];
      if (body.kind === "swimlane" && lane !== undefined) {
        const to = body.lanes[lane];
        const from = body.lanes.findIndex((l) =>
          l.cells.some((cell) => cell.some((w) => w.key === key)),
        );
        if (to && lane !== from) {
          const fields = laneChange(body.by, to.key, to.cells.flat());
          if (!fields)
            throw new Error(
              `Moving between lanes cannot change the ${FIELDS[body.by]?.title.toLowerCase() ?? body.by}.`,
            );
          await update(work, fields);
        }
      }
      const now = s.works.find((w) => w.key === key) ?? work;
      if (target) await move(now, statusFor(target, now), target.category);
    } catch (error) {
      fail(error);
    }
  };

  /** Shift+arrows: the selected card to the next or previous column. */
  const shift = async (/** @type {1 | -1} */ dir) => {
    const { body } = screen();
    const work = s.works.find((w) => w.key === s.selected);
    if (!work || (body.kind !== "kanban" && body.kind !== "swimlane")) return;
    const at = body.columns.findIndex((c) => c.works.some((w) => w.key === work.key));
    const target = body.columns[at + dir];
    if (!target) return;
    try {
      await move(work, statusFor(target, work), target.category);
    } catch (error) {
      fail(error);
    }
  };

  return { move, update, drop, shift, can };
}
