// One action on many objects (DOCK-19): one docker call per object, a few at a time, every failure
// kept with docker's own words instead of stopping the rest, and one sentence for all of it.

/**
 * @template T
 * @typedef {{ done: T[], failed: Array<{ item: T, message: string }> }} Outcome
 */

/** How many docker calls a bulk action runs at once. */
export const CONCURRENCY = 4;

/**
 * Run `fn` on every item, `concurrency` at a time, in the items' order.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => Promise<unknown>} fn
 * @param {number} [concurrency]
 * @returns {Promise<Outcome<T>>}
 */
export async function runEach(items, fn, concurrency = CONCURRENCY) {
  /** @type {Array<{ ok: true } | { ok: false, message: string } | undefined>} */
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const at = next++;
      try {
        await fn(/** @type {T} */ (items[at]));
        results[at] = { ok: true };
      } catch (error) {
        if (/** @type {{ cancelled?: boolean }} */ (error)?.cancelled) throw error;
        results[at] = {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  /** @type {Outcome<T>} */
  const outcome = { done: [], failed: [] };
  results.forEach((result, at) => {
    const item = /** @type {T} */ (items[at]);
    if (result?.ok) outcome.done.push(item);
    else outcome.failed.push({ item, message: result?.message ?? "It did not run." });
  });
  return outcome;
}

const plural = (/** @type {number} */ n, /** @type {string} */ noun) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * "Stopped 3 containers." or "Stopped 2 of 3 containers. scratch: No such container."
 * @param {{ past: string, verb: string }} words As `Stopped` and `stop`.
 * @param {string} noun One of what was acted on, as `container`.
 * @param {number} done
 * @param {Array<{ name: string, message: string }>} failed
 */
export function bulkSentence({ past, verb }, noun, done, failed) {
  const total = done + failed.length;
  if (failed.length === 0) return `${past} ${plural(total, noun)}.`;
  const why = failed
    .slice(0, 3)
    .map((f) => `${f.name}: ${f.message.replace(/\.$/, "")}.`)
    .join(" ");
  const more = failed.length > 3 ? ` And ${failed.length - 3} more.` : "";
  if (done === 0) return `Could not ${verb} any of the ${plural(total, noun)}. ${why}${more}`;
  return `${past} ${done} of ${plural(total, noun)}. ${why}${more}`;
}
