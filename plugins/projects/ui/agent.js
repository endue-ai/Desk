// What an agent reads through Projects (ADR 0088): the tasks the plugin holds from every connected
// tracker, narrowed as asked, and one task with its text, as data, leaving the screen as it is. A
// task is named by the `{ source, id }` the answers carry; show, move and update take the same
// names (commands.js), and move and update go to the tracker through its connector.

/**
 * @typedef {import("./adapters/common.js").Work} Work
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** How long a task's text may be in an answer, in characters. */
export const BODY_MAX = 20000;

/** A task as an agent reads it in a list. */
export function taskAnswer(/** @type {Work} */ w) {
  return {
    source: w.source,
    id: w.id,
    ref: w.ref || null,
    title: w.title,
    status: w.status,
    category: w.category,
    priority: w.priority,
    assignee: w.assignee ? (w.assignee.name ?? w.assignee.email ?? null) : null,
    ...(w.project ? { project: w.project } : {}),
    ...(w.sprint ? { sprint: w.sprint } : {}),
    ...(w.start ? { start: w.start } : {}),
    ...(w.due ? { due: w.due } : {}),
    labels: w.labels,
    updatedAt: w.updatedAt,
  };
}

const text = (/** @type {unknown} */ v) =>
  typeof v === "string" && v.trim() !== "" ? v.trim().toLowerCase() : undefined;

/**
 * @param {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} answer
 * @param {{ works(): Work[], named(a: Record<string, unknown>): Promise<Work> }} deps
 */
export function answerAgents(answer, deps) {
  answer("endue.projects.tasks", (a) => {
    const words = (text(a.query) ?? "").split(/\s+/).filter(Boolean);
    const source = text(a.source);
    const status = text(a.status);
    const who = text(a.assignee);
    const before = typeof a.dueBefore === "string" && DATE.test(a.dueBefore) ? a.dueBefore : "";
    if (a.dueBefore !== undefined && !before) throw new Error("dueBefore is a date, YYYY-MM-DD.");
    const open = a.done !== true;
    const all = deps.works().filter((w) => {
      if (open && (w.category === "done" || w.category === "cancelled")) return false;
      if (source && !`${w.source.connector}/${w.source.instance}`.toLowerCase().includes(source))
        return false;
      if (status && w.status.toLowerCase() !== status && w.category !== status) return false;
      const person = `${w.assignee?.name ?? ""} ${w.assignee?.email ?? ""}`.toLowerCase();
      if (who && !person.includes(who)) return false;
      if (before && !(w.due && w.due < before)) return false;
      const hay = `${w.ref} ${w.title} ${w.project ?? ""} ${w.labels.join(" ")}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
    all.sort(
      (x, y) =>
        (x.due ?? "9999").localeCompare(y.due ?? "9999") || (x.priority ?? 9) - (y.priority ?? 9),
    );
    const asked = Number(a.limit);
    const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 200) : 50;
    const statuses = [...new Set(deps.works().map((w) => w.status))];
    return {
      tasks: all.slice(0, limit).map(taskAnswer),
      total: all.length,
      more: all.length > limit,
      statuses,
    };
  });

  answer("endue.projects.task", async (a) => {
    const w = await deps.named(a);
    const body = w.body ?? "";
    return {
      ...taskAnswer(w),
      ...(w.type ? { type: w.type } : {}),
      ...(w.parent ? { parent: w.parent } : {}),
      ...(w.estimate !== undefined ? { estimate: w.estimate } : {}),
      ...(w.url ? { url: w.url } : {}),
      body: body.slice(0, BODY_MAX),
      truncated: body.length > BODY_MAX,
    };
  });
}
