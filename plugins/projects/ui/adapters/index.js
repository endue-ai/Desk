// The adapters: one per source the plugin knows by name (Jira, Linear, Asana), each recognizing its
// items by their connector's id or the shape of their `raw`, and the envelope for every other task
// connector. Whichever source an item came from, it leaves here as one Work.
import * as asana from "./asana.js";
import { categoryOfName, dateOf, envelopeOf, objectOf, over, personOf, textOf } from "./common.js";
import * as jira from "./jira.js";
import * as linear from "./linear.js";

/**
 * @typedef {import("./common.js").Work} Work
 * @typedef {import("./common.js").System} System
 * @typedef {import("@endue-ai/bridge").TaskItem} TaskItem
 * @typedef {{ system: System, title: string, detect(item: TaskItem): boolean, adapt(item: TaskItem): Partial<Work> }} Adapter
 */

/** @type {Adapter[]} */
export const ADAPTERS = [
  { system: "jira", title: "Jira", ...jira },
  { system: "linear", title: "Linear", ...linear },
  { system: "asana", title: "Asana", ...asana },
];

/** What a source is called on screen: Jira, Linear, Asana, or the connector's own id. */
export const systemTitle = (/** @type {System} */ system, /** @type {string} */ connector) =>
  ADAPTERS.find((a) => a.system === system)?.title ?? connector;

/** Any other task connector: the envelope, with the common `raw` names it may carry. */
function generic(/** @type {TaskItem} */ item) {
  const raw = objectOf(item.raw) ?? {};
  const status = textOf(raw.status);
  const assignee = personOf(raw.assignee);
  return /** @type {Partial<Work>} */ ({
    ...(status && item.status === "open" ? { status, category: categoryOfName(status) } : {}),
    ...(assignee ? { assignee } : {}),
    start: dateOf(raw.start),
    sprint: textOf(raw.sprint),
    type: textOf(raw.type),
  });
}

/** The adapter an item's source needs, or undefined for the envelope alone. */
export const adapterOf = (/** @type {TaskItem} */ item) => ADAPTERS.find((a) => a.detect(item));

/** One task item as the plugin shows it, whatever its source. @returns {Work} */
export function workOf(/** @type {TaskItem} */ item) {
  const base = envelopeOf(item);
  const adapter = adapterOf(item);
  try {
    return over(base, adapter ? adapter.adapt(item) : generic(item));
  } catch {
    // A raw that surprises an adapter still shows: as the envelope says it.
    return base;
  }
}
