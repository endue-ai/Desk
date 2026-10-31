// What each component shows of its items, as data for its @endue-ai/ui element: list options,
// table columns and rows, agenda events, a stat's number, markdown source, a card's lines. Pure: the
// DOM view (render.js) sets these on the elements; tests read them as they are.

import { fill, firstPath, rfc3339, valueAt } from "./template.js";

/**
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").ViewField} ViewField
 * @typedef {import("./template.js").Env} Env
 * @typedef {import("./engine.js").ComponentModel} ComponentModel
 * @typedef {{ kind: "list", label: string, options: Array<{ key: string, title: string, detail: string }> }} ListData
 * @typedef {{ kind: "table", label: string, columns: Array<{ key: string, label: string, sortable: boolean }>,
 *   rows: Array<{ key: string, cells: Record<string, string>, values: Record<string, unknown> }>,
 *   sort: { key: string, direction: "ascending" | "descending" } | null }} TableData
 * @typedef {{ kind: "agenda", label: string, zone: string, locale: string, now: string,
 *   events: Array<{ key: string, title: string, start: string, end?: string, allDay?: boolean, detail?: string }> }} AgendaData
 * @typedef {{ kind: "stat", label: string, value: string, unit: string }} StatData
 * @typedef {{ kind: "markdown", source: string }} MarkdownData
 * @typedef {{ kind: "card", heading: string, lines: Array<{ label?: string, text: string }> }} CardData
 * @typedef {ListData | TableData | AgendaData | StatData | MarkdownData | CardData} Presented
 */

const TITLE = [{ value: "{title}" }];

/** The key that names an item on screen: its connector, instance and id. */
export const keyOf = (/** @type {Item} */ item) =>
  `${item.source.connector}/${item.source.instance}/${item.id}`;

/**
 * One field's text: its value, after its label when it has one ("Due tomorrow").
 * @param {ViewField | undefined} field
 * @param {Item} item
 * @param {Env} env
 */
function line(field, item, env) {
  if (!field) return "";
  const value = fill(field.value, item, env).trim();
  return field.label && value ? `${field.label} ${value}` : value;
}

/** The detail line: every field after the first, joined. */
function detail(
  /** @type {ViewField[]} */ fields,
  /** @type {Item} */ item,
  /** @type {Env} */ env,
) {
  return fields
    .slice(1)
    .map((field) => line(field, item, env))
    .filter(Boolean)
    .join(" · ");
}

/**
 * The element data for one component.
 * @param {ComponentModel} component
 * @param {Env} env
 * @returns {Presented}
 */
export function present(component, env) {
  const { node, items } = component;
  const fields = node.fields?.length ? node.fields : TITLE;
  const label = component.title || component.label || component.type;
  switch (node.type) {
    case "table": {
      const columns = fields.map((field, i) => ({
        key: `c${i}`,
        label: field.label ?? "",
        sortable: true,
      }));
      const paths = fields.map((field) => firstPath(field.value));
      const rows = items.map((item) => ({
        key: keyOf(item),
        cells: Object.fromEntries(
          fields.map((field, i) => [`c${i}`, fill(field.value, item, env)]),
        ),
        values: Object.fromEntries(
          paths.map((path, i) => [`c${i}`, path ? valueAt(item, path) : undefined]),
        ),
      }));
      const first = node.binding?.sort?.[0];
      const at = first ? paths.indexOf(first.field) : -1;
      const direction = first?.dir === "desc" ? "descending" : "ascending";
      return {
        kind: "table",
        label,
        columns,
        rows,
        sort: at >= 0 ? { key: `c${at}`, direction } : null,
      };
    }
    case "agenda":
      return {
        kind: "agenda",
        label,
        zone: env.zone,
        locale: env.locale,
        now: rfc3339(env.now, env.zone),
        events: items.map((item) => {
          const event = /** @type {{ start?: string, end?: string, allDay?: boolean }} */ (item);
          return {
            key: keyOf(item),
            title: line(fields[0], item, env),
            start: event.start ?? item.updatedAt,
            ...(event.end ? { end: event.end } : {}),
            ...(event.allDay ? { allDay: true } : {}),
            detail: detail(fields, item, env),
          };
        }),
      };
    case "stat":
      return { kind: "stat", label, ...statOf(component, env) };
    case "markdown": {
      const text = node.text ?? items[0]?.body ?? "";
      return { kind: "markdown", source: fill(text, items[0] ?? {}, env) };
    }
    case "card": {
      const item = items[0];
      const lines = item
        ? fields.map((field) => ({
            ...(field.label ? { label: field.label } : {}),
            text: fill(field.value, item, env),
          }))
        : [];
      return { kind: "card", heading: component.title, lines };
    }
    default:
      return {
        kind: "list",
        label,
        options: items.map((item) => ({
          key: keyOf(item),
          title: line(fields[0], item, env),
          detail: detail(fields, item, env),
        })),
      };
  }
}

/**
 * A stat's number: its `text` for the first item, a metric's last point with its unit, or how many
 * items match (and more, when the page has a next one).
 * @param {ComponentModel} component
 * @param {Env} env
 */
function statOf({ node, items, more }, env) {
  const first = items[0];
  if (node.text !== undefined) return { value: fill(node.text, first ?? {}, env), unit: "" };
  if (first?.kind === "metric") {
    const last = first.points[first.points.length - 1];
    const value = last ? new Intl.NumberFormat(env.locale).format(last.v) : "";
    return { value, unit: first.unit ?? "" };
  }
  const count = new Intl.NumberFormat(env.locale).format(items.length);
  return { value: more ? `${count}+` : count, unit: "" };
}
