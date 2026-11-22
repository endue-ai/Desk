// What the person chose about Eris, per connection (PG-90, ADR 0345), kept in the plugin's store
// under `assist`: the connections that saw what is sent (`shown`), those closed to the brain
// (`closed`), those whose sample is ticked (`sample`) and the production ones whose samples are
// turned on (`production`), each a list of connection ids. Nothing else is kept: no prompt, no
// answer.

/**
 * @typedef {{ shown: boolean, closed: boolean, sample: boolean, production: boolean }} Choice
 * @typedef {{ shown: string[], closed: string[], sample: string[], production: string[] }} Kept
 */

export const STORE_KEY = "assist";
const FIELDS = /** @type {const} */ (["shown", "closed", "sample", "production"]);

/** A stored value read leniently: unknown fields and ids that are not strings are dropped. */
export function keptOf(/** @type {unknown} */ value) {
  const v = /** @type {Record<string, unknown>} */ (
    value && typeof value === "object" ? value : {}
  );
  return /** @type {Kept} */ (
    Object.fromEntries(
      FIELDS.map((f) => [
        f,
        Array.isArray(v[f]) ? v[f].filter((id) => typeof id === "string") : [],
      ]),
    )
  );
}

/** @param {{ call(method: string, params?: any): Promise<any> }} bridge */
export function createChoices(bridge) {
  /** @type {Promise<Kept> | undefined} */
  let loaded;
  const load = () => {
    loaded ??= bridge
      .call("store.get", { key: STORE_KEY })
      .then((answer) => keptOf(answer?.value))
      .catch(() => keptOf(undefined));
    return loaded;
  };
  return {
    /** @returns {Promise<Choice>} */
    async of(/** @type {string} */ id) {
      const kept = await load();
      return /** @type {Choice} */ (
        Object.fromEntries(FIELDS.map((f) => [f, kept[f].includes(id)]))
      );
    },
    /** Change some of a connection's choices and keep them. */
    async set(/** @type {string} */ id, /** @type {Partial<Choice>} */ change) {
      const kept = await load();
      for (const f of FIELDS) {
        if (change[f] === undefined) continue;
        kept[f] = kept[f].filter((other) => other !== id);
        if (change[f]) kept[f].push(id);
      }
      await bridge.call("store.set", { key: STORE_KEY, value: kept });
    },
  };
}
