// iCalendar objects as a tree of components (RFC 5545 §3.4, §3.6): BEGIN and END nest components,
// every other line is a property of the innermost one. Parsing never throws: what it cannot read
// becomes a problem with its line number, and lines it cannot parse are kept verbatim so a save
// writes back everything another app wrote.
import { formatLine, parseLine, unescapeText, unfold } from "./lines.js";

/**
 * @typedef {import("./lines.js").Prop} Prop
 * @typedef {{ name: string, props: Prop[], components: Component[] }} Component
 * @typedef {{ line: number, message: string }} Problem
 * @typedef {{ calendars: Component[], problems: Problem[] }} Document
 */

/**
 * Parse an iCalendar stream: one or more VCALENDAR objects.
 * @param {string} text
 * @returns {Document}
 */
export function parse(text) {
  const lines = unfold(text);
  /** @type {Component[]} */
  const calendars = [];
  /** @type {Problem[]} */
  const problems = [];
  /** @type {Component[]} */
  const stack = [];
  for (const { text: line, line: number } of lines) {
    const prop = parseLine(line);
    const top = stack.at(-1);
    if (!prop) {
      if (top) top.props.push({ name: "", params: {}, value: "", raw: line });
      problems.push({
        line: number,
        message: `Line ${number} is not a property and is kept as is.`,
      });
      continue;
    }
    if (prop.name === "BEGIN") {
      /** @type {Component} */
      const component = { name: prop.value.trim().toUpperCase(), props: [], components: [] };
      if (top) top.components.push(component);
      else if (component.name === "VCALENDAR") calendars.push(component);
      else {
        // Read on so its END matches, then drop it.
        problems.push({ line: number, message: `${component.name} outside VCALENDAR is ignored.` });
      }
      stack.push(component);
      continue;
    }
    if (prop.name === "END") {
      const name = prop.value.trim().toUpperCase();
      const at = stack.map((c) => c.name).lastIndexOf(name);
      if (at < 0) {
        problems.push({ line: number, message: `END:${name} has no BEGIN.` });
        continue;
      }
      if (at !== stack.length - 1)
        problems.push({ line: number, message: `${stack.at(-1)?.name} was not closed.` });
      stack.length = at;
      continue;
    }
    if (top) top.props.push(prop);
    else problems.push({ line: number, message: `${prop.name} outside VCALENDAR is ignored.` });
  }
  for (const open of stack)
    problems.push({ line: lines.at(-1)?.line ?? 0, message: `${open.name} was not closed.` });
  if (calendars.length === 0 && text.trim() !== "")
    problems.push({ line: 1, message: "The file holds no VCALENDAR." });
  return { calendars, problems };
}

/**
 * Write a component and everything in it as folded lines with CRLF.
 * @param {Component} component
 * @returns {string}
 */
export function formatComponent(component) {
  let out = formatLine({ name: "BEGIN", params: {}, value: component.name });
  for (const prop of component.props) out += formatLine(prop);
  for (const child of component.components) out += formatComponent(child);
  return out + formatLine({ name: "END", params: {}, value: component.name });
}

/**
 * The first property with this name.
 * @param {Component} component
 * @param {string} name
 */
export const prop = (component, name) => component.props.find((p) => p.name === name);

/**
 * Every property with this name.
 * @param {Component} component
 * @param {string} name
 */
export const props = (component, name) => component.props.filter((p) => p.name === name);

/**
 * The first value of a property's parameter.
 * @param {Prop | undefined} property
 * @param {string} name
 */
export const param = (property, name) => property?.params[name]?.[0];

/**
 * A TEXT property's decoded value, or undefined.
 * @param {Component} component
 * @param {string} name
 */
export const text = (component, name) => {
  const found = prop(component, name);
  return found ? unescapeText(found.value) : undefined;
};

/**
 * Replace every property with this name by `next` (none when undefined), at the place of the first.
 * @param {Component} component
 * @param {string} name
 * @param {Prop | Prop[] | undefined} next
 */
export function setProp(component, name, next) {
  const replacement = next === undefined ? [] : Array.isArray(next) ? next : [next];
  const at = component.props.findIndex((p) => p.name === name);
  const kept = component.props.filter((p) => p.name !== name);
  const index = at < 0 ? kept.length : at;
  component.props = [...kept.slice(0, index), ...replacement, ...kept.slice(index)];
}

/**
 * A deep copy, so an edit never reaches the component (or document) it came from.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export const clone = (value) => structuredClone(value);
