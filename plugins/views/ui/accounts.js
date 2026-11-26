// A saved item's view remembers each compatible account the person picks for it.
import { choose } from "./resolve.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").View} View
 * @typedef {import("@endue-ai/bridge").ConnectorInfo} ConnectorInfo
 * @typedef {import("@endue-ai/bridge").ConnectorInstance} ConnectorInstance
 * @typedef {import("./resolve.js").Binding} Binding
 * @typedef {import("./resolve.js").Bound} Bound
 * @typedef {Record<string, Record<string, Binding>>} Bucket
 */

const CONNECTORS = /** @type {const} */ ({ permission: "connector:manage" });
// View IDs can be longer than store keys. Entries in a bucket still use the full ID.
const keyOf = (/** @type {string} */ id) => `bindings.${id.slice(0, 55)}`;

/** @param {Pick<PluginContext, "bridge" | "commands">} ctx */
export function createAccounts(ctx) {
  /** @type {Map<string, Promise<Bucket>>} */
  const buckets = new Map();
  /** @type {Map<string, Promise<Bound | undefined>>} */
  const choosing = new Map();
  let writes = Promise.resolve();

  const bucket = (/** @type {string} */ key) => {
    const held = buckets.get(key);
    if (held) return held;
    const load = ctx.bridge.call("store.get", { key }).then(
      ({ value }) => /** @type {Bucket} */ (value && typeof value === "object" ? value : {}),
      () => ({}),
    );
    buckets.set(key, load);
    return load;
  };

  const remember = async (
    /** @type {string} */ id,
    /** @type {Record<string, Bound>} */ selected,
  ) => {
    const key = keyOf(id);
    const all = await bucket(key);
    all[id] = { ...all[id], ...selected };
    const value = structuredClone(all);
    writes = writes.then(() =>
      ctx.bridge.call("store.set", { key, value }).then(
        () => {},
        () => {},
      ),
    );
    await writes;
  };

  const pick = (
    /** @type {View} */ view,
    /** @type {string} */ name,
    /** @type {ConnectorInstance[]} */ candidates,
    existing = false,
  ) => {
    const key = `${view.id}:${name}`;
    const held = existing && choosing.get(key);
    if (held) return held;
    const items = candidates.map((i) => ({
      id: `${i.connector}/${i.instance}`,
      label: i.title ?? i.instance,
      detail: `${i.connector} · ${i.status.state}`,
    }));
    const title = view.requires?.[name]?.title ?? `Pick a source for ${name}`;
    const answer = ctx.commands.run("desk.palette.pick", { title, items }).then(
      (id) => {
        const found = candidates.find((i) => `${i.connector}/${i.instance}` === id);
        return found && { connector: found.connector, instance: found.instance };
      },
      () => undefined,
    );
    if (existing) {
      choosing.set(key, answer);
      void answer.finally(() => choosing.delete(key));
    }
    return answer;
  };

  return {
    list: () => ctx.bridge.call("connector.list", { scope: CONNECTORS }).catch(() => null),
    async resolve(
      /** @type {View} */ view,
      /** @type {ConnectorInfo[]} */ connectors,
      /** @type {Record<string, Binding>} */ given,
      /** @type {{ saved: boolean, active?: () => boolean }} */ { saved, active },
    ) {
      let choice = choose(view, connectors, given);
      if (Object.keys(choice.pick).length === 0) return choice;
      if (saved) {
        const kept = (await bucket(keyOf(view.id)))[view.id];
        choice = choose(view, connectors, { ...kept, ...given });
      }
      if (!active) return choice;
      /** @type {Record<string, Bound>} */
      const selected = {};
      for (const [name, candidates] of Object.entries(choice.pick)) {
        if (!active()) return choice;
        const found = await pick(view, name, candidates, saved);
        if (
          found &&
          candidates.some((i) => i.connector === found.connector && i.instance === found.instance)
        ) {
          choice.bound[name] = found;
          selected[name] = found;
        }
      }
      if (saved && active() && Object.keys(selected).length > 0) await remember(view.id, selected);
      return choice;
    },
  };
}
