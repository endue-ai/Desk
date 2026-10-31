// The components of an open view without a DOM: the layout tree as models, each bound component's
// query (its `$name` sources bound, its templates and an agenda's window filled from the clock), and
// the state it is in, from its answer and its sources' status. Pure.

import { bindQuery, instancesOf } from "./resolve.js";
import { dayStart, fill, fillValue, rfc3339 } from "./template.js";

/**
 * @typedef {import("@endue-ai/bridge").ConnectorInfo} ConnectorInfo
 * @typedef {import("@endue-ai/bridge").ConnectorStatus} ConnectorStatus
 * @typedef {import("@endue-ai/bridge").DataReadPermission} DataReadPermission
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ViewComponent} ViewComponent
 * @typedef {import("@endue-ai/bridge").ViewNode} ViewNode
 * @typedef {import("./resolve.js").Bound} Bound
 * @typedef {import("./template.js").Env} Env
 * @typedef {"loading" | "ready" | "empty" | "stale" | "error" | "denied" | "unbound" | "placeholder"} ComponentState
 * @typedef {{ kind: "component", path: string, type: string, title: string, state: ComponentState,
 *   message: string, items: Item[], more: boolean, node: ViewComponent, kinds?: string[], label?: string,
 *   instance?: Bound, scope?: DataReadPermission }} ComponentModel
 * @typedef {{ kind: "container", path: string, type: string, title: string, columns?: number,
 *   direction?: string, children: NodeModel[] }} ContainerModel
 * @typedef {ComponentModel | ContainerModel} NodeModel
 * @typedef {{ model: ComponentModel, binding?: ItemQuery, answered: boolean, failed?: string,
 *   refused?: DataReadPermission, asked: number, unsubscribe?: () => void }} Live
 */

/** Components the engine does not draw yet; each says so instead of drawing nothing. */
export const LATER = new Set(["calendar", "kanban", "chart", "detail"]);
const CONTAINERS = new Set(["grid", "split", "tabs", "stack"]);
const named = (/** @type {string} */ type) => type.charAt(0).toUpperCase() + type.slice(1);

/**
 * The layout tree as models, and the live components by path ("0", "0.1", ...).
 * @param {ViewNode} node
 * @param {Record<string, Bound>} bound
 * @param {Env} env
 * @param {string} [path]
 * @param {Map<string, Live>} [live]
 * @returns {{ root: NodeModel, live: Map<string, Live> }}
 */
export function build(node, bound, env, path = "0", live = new Map()) {
  const title = node.title === undefined ? "" : fill(node.title, {}, env);
  if (CONTAINERS.has(node.type)) {
    const container = /** @type {import("@endue-ai/bridge").ViewContainer} */ (node);
    const children = container.children.map(
      (child, i) => build(child, bound, env, `${path}.${i}`, live).root,
    );
    /** @type {ContainerModel} */
    const root = {
      kind: "container",
      path,
      type: node.type,
      title,
      children,
      ...(container.columns ? { columns: container.columns } : {}),
      ...(container.direction ? { direction: container.direction } : {}),
    };
    return { root, live };
  }
  const component = /** @type {ViewComponent} */ (node);
  /** @type {ComponentModel} */
  const model = {
    kind: "component",
    path,
    type: node.type,
    title,
    state: "loading",
    message: "",
    items: [],
    more: false,
    node: structuredClone(component),
  };
  /** @type {Live} */
  const entry = { model, answered: false, asked: 0 };
  if (LATER.has(node.type)) {
    model.state = "placeholder";
    model.message = `${named(node.type)} comes later`;
  } else if (component.binding) {
    const binding = bindQuery(component.binding, bound);
    if (binding) entry.binding = binding;
    else {
      model.state = "unbound";
      model.message = "No source is connected for this yet.";
      model.kinds = [...(component.binding.kinds ?? [])];
    }
  } else {
    entry.answered = true;
  }
  live.set(path, entry);
  return { root: model, live };
}

/**
 * The query a live component asks now: its binding with every template filled from the clock, and an
 * agenda narrowed to its range (a day unless it says a week or a month).
 * @param {Live} entry
 * @param {Env} env
 * @returns {ItemQuery}
 */
export function queryOf(entry, env) {
  const query = fillValue(/** @type {ItemQuery} */ (entry.binding), {}, env);
  if (entry.model.type !== "agenda") return query;
  const range = entry.model.node.range ?? "day";
  const shift = range === "week" ? { days: 7 } : range === "month" ? { months: 1 } : { days: 1 };
  const from = rfc3339(dayStart(env.now, env.zone), env.zone);
  const to = rfc3339(dayStart(env.now, env.zone, shift), env.zone);
  /** @type {import("@endue-ai/bridge").ItemCondition[]} */
  const window = [
    { field: "start", op: "lt", value: to },
    { field: "end", op: "gt", value: from },
  ];
  return { ...query, where: [...(query.where ?? []), ...window] };
}

/** How bad a status is, for a component reading several instances. */
const WORST = ["connected", "syncing", "paused", "stale", "error"];

/**
 * The status of the instances a component reads: the worst, with its instance.
 * @param {Live} entry
 * @param {ConnectorInfo[]} connectors
 * @returns {{ status?: ConnectorStatus, instance?: Bound }}
 */
function statusOf(entry, connectors) {
  /** @type {{ status?: ConnectorStatus, instance?: Bound }} */
  let worst = {};
  for (const key of instancesOf(entry.binding ?? {})) {
    const [connector = "", instance = ""] = key.split("/");
    const found = connectors
      .find((c) => c.id === connector)
      ?.instances.find((i) => i.instance === instance);
    const rank = WORST.indexOf(found?.status.state ?? "connected");
    if (!worst.status || rank > WORST.indexOf(worst.status.state))
      worst = {
        status: found?.status ?? { state: "connected" },
        instance: { connector, instance },
      };
  }
  return worst;
}

/**
 * Set a live component's state and message from what it knows: never blank.
 * @param {Live} entry
 * @param {ConnectorInfo[]} connectors
 * @param {Env} env
 * @param {(ms: number) => string} ago  a relative time ("1 hour ago")
 */
export function settle(entry, connectors, env, ago) {
  const { model } = entry;
  if (model.state === "placeholder" || model.state === "unbound") return;
  const { status, instance } = statusOf(entry, connectors);
  if (instance) model.instance = instance;
  else delete model.instance;
  delete model.scope;
  if (entry.refused) {
    model.state = "denied";
    model.scope = entry.refused;
    model.message = "Desk may not read these items yet.";
  } else if (entry.failed) {
    model.state = "error";
    model.message = entry.failed;
  } else if (!entry.answered) {
    model.state = "loading";
    model.message = "Loading…";
  } else if (status?.state === "error") {
    model.state = "error";
    model.message = status.error?.message ?? "The source stopped answering.";
  } else if (status?.state === "stale" || status?.state === "paused") {
    model.state = "stale";
    const last = status.lastSyncAt ? Date.parse(status.lastSyncAt) : Number.NaN;
    model.message = Number.isNaN(last) ? "Not synced yet" : `Last synced ${ago(last - env.now)}`;
  } else if (model.items.length === 0 && !shows(model)) {
    model.state = "empty";
    model.message = model.node.empty ?? "Nothing here";
  } else {
    model.state = "ready";
    model.message = "";
  }
}

/** Whether a component has something to show without items: a count, or its own text. */
const shows = (/** @type {ComponentModel} */ model) =>
  (model.type === "stat" && model.node.empty === undefined) ||
  (model.type === "markdown" && model.node.text !== undefined) ||
  !model.node.binding;

/**
 * The narrowest data:read scope a bound query reads under (as ctx.data.query asks), for a refusal
 * that does not name one.
 * @param {ItemQuery} query
 * @returns {DataReadPermission}
 */
export function scopeOf(query) {
  const connectors = query.sources?.map((source) => source.split("/")[0] ?? source);
  return {
    permission: "data:read",
    ...(query.kinds ? { kinds: [...query.kinds] } : {}),
    ...(connectors ? { sources: [...new Set(connectors)] } : {}),
  };
}
