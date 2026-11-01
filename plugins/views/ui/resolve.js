// A view's requires against the connected sources (connector.list): which instances can serve each,
// which one each is bound to, and a binding's `$name` sources replaced by that instance. Pure.

/**
 * @typedef {import("@endue-ai/bridge").ConnectorInfo} ConnectorInfo
 * @typedef {import("@endue-ai/bridge").ConnectorInstance} ConnectorInstance
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").View} View
 * @typedef {import("@endue-ai/bridge").ViewRequirement} ViewRequirement
 * @typedef {{ connector: string, instance: string }} Bound
 * @typedef {string | Bound} Binding  what desk.views.open's `bindings` give: "connector/instance"
 * @typedef {{ bound: Record<string, Bound>, pick: Record<string, ConnectorInstance[]>, none: string[] }} Choice
 */

/**
 * The instances, in any status, of the connectors whose resources cover every kind the require names
 * and that are the connector it names, if it names one.
 * @param {ViewRequirement} require
 * @param {ConnectorInfo[]} connectors
 * @returns {ConnectorInstance[]}
 */
export function candidates(require, connectors) {
  return connectors
    .filter((c) => require.connector === undefined || c.id === require.connector)
    .filter((c) => require.kinds.every((kind) => c.resources.some((r) => r.kind === kind)))
    .flatMap((c) => c.instances);
}

/**
 * `connector/instance`, or `{ connector, instance }`, as a Bound.
 * @param {Binding | undefined} binding
 * @returns {Bound | undefined}
 */
function boundOf(binding) {
  if (typeof binding === "string") {
    const slash = binding.indexOf("/");
    if (slash <= 0) return undefined;
    return { connector: binding.slice(0, slash), instance: binding.slice(slash + 1) };
  }
  if (binding && typeof binding.connector === "string" && typeof binding.instance === "string")
    return { connector: binding.connector, instance: binding.instance };
  return undefined;
}

/**
 * Each require bound: by the bindings given (when they name a candidate), else to its only
 * candidate; several candidates are left to a pick, none leaves it unbound.
 * @param {View} view
 * @param {ConnectorInfo[]} connectors
 * @param {Record<string, Binding>} bindings
 * @returns {Choice}
 */
export function choose(view, connectors, bindings) {
  /** @type {Choice} */
  const choice = { bound: {}, pick: {}, none: [] };
  for (const [name, require] of Object.entries(view.requires ?? {})) {
    const found = candidates(require, connectors);
    const given = boundOf(bindings[name]);
    const named =
      given && found.find((i) => i.connector === given.connector && i.instance === given.instance);
    const only = found.length === 1 ? found[0] : undefined;
    const chosen = named ?? only;
    if (chosen) choice.bound[name] = { connector: chosen.connector, instance: chosen.instance };
    else if (found.length > 1) choice.pick[name] = found;
    else choice.none.push(name);
  }
  return choice;
}

/**
 * A binding with its `$name` sources replaced by the instances they are bound to; undefined while
 * one of them is unbound. The binding itself is left as it was.
 * @param {ItemQuery} query
 * @param {Record<string, Bound>} bound
 * @returns {ItemQuery | undefined}
 */
export function bindQuery(query, bound) {
  if (!query.sources) return structuredClone(query);
  /** @type {string[]} */
  const sources = [];
  for (const source of query.sources) {
    if (!source.startsWith("$")) sources.push(source);
    else {
      const instance = bound[source.slice(1)];
      if (!instance) return undefined;
      sources.push(`${instance.connector}/${instance.instance}`);
    }
  }
  return { ...structuredClone(query), sources };
}

/**
 * The instances a bound query reads, as `connector/instance` keys.
 * @param {ItemQuery} query
 */
export function instancesOf(query) {
  return (query.sources ?? []).filter((source) => source.includes("/"));
}
