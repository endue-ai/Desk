// iCalendar objects as a tree of components (RFC 5545 §3.4, §3.6): BEGIN and END nest components,
// every other line is a property of the innermost one. Parsing never throws: a line it cannot read
// becomes a problem with its number and is skipped, so one odd line never hides an invitation.
import { fold, formatLine, parseLine, unescapeText, unfold } from "./lines.js";

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
  /** @type {Component[]} */
  const calendars = [];
  /** @type {Problem[]} */
  const problems = [];
  /** @type {Component[]} */
  const stack = [];
  unfold(text).forEach((line, index) => {
    const number = index + 1;
    const prop = parseLine(line);
    const top = stack.at(-1);
    if (!prop) {
      problems.push({ line: number, message: `Line ${number} is not a property.` });
      return;
    }
    if (prop.name === "BEGIN") {
      /** @type {Component} */
      const component = { name: prop.value.trim().toUpperCase(), props: [], components: [] };
      if (top) top.components.push(component);
      else if (component.name === "VCALENDAR") calendars.push(component);
      else problems.push({ line: number, message: `${component.name} is outside a VCALENDAR.` });
      stack.push(component);
    } else if (prop.name === "END") {
      const name = prop.value.trim().toUpperCase();
      if (!top || top.name !== name)
        problems.push({ line: number, message: `END:${name} closes nothing.` });
      else stack.pop();
    } else if (top) top.props.push(prop);
    else problems.push({ line: number, message: `Line ${number} is outside a component.` });
  });
  for (const open of stack) problems.push({ line: 0, message: `${open.name} is never ended.` });
  return { calendars, problems };
}

/**
 * Write a component and everything in it, folded, with CRLF line ends.
 * @param {Component} component
 */
export function serialize(component) {
  let out = fold(`BEGIN:${component.name}`);
  for (const prop of component.props) out += formatLine(prop);
  for (const child of component.components) out += serialize(child);
  return out + fold(`END:${component.name}`);
}

/**
 * The first property with a name, or undefined.
 * @param {Component} component
 * @param {string} name
 */
export const prop = (component, name) => component.props.find((p) => p.name === name);

/**
 * Every property with a name, in order.
 * @param {Component} component
 * @param {string} name
 */
export const props = (component, name) => component.props.filter((p) => p.name === name);

/**
 * The decoded TEXT of the first property with a name, or undefined when absent or empty.
 * @param {Component} component
 * @param {string} name
 */
export function text(component, name) {
  const found = prop(component, name);
  if (!found) return undefined;
  const value = unescapeText(found.value).trim();
  return value === "" ? undefined : value;
}

/**
 * The first value of a parameter of a property, or undefined.
 * @param {Prop} property
 * @param {string} name
 */
export const param = (property, name) => property.params[name]?.[0];

/**
 * The components with a name, in order.
 * @param {Component} component
 * @param {string} name
 */
export const children = (component, name) => component.components.filter((c) => c.name === name);
