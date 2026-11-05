#!/usr/bin/env node
// ds-lint: design system conformance (docs/ko/design-system-requirements.md DC-01, DC-04, ADR 0090).
// Every control of Desk's UI is a design system component: an @endue-ai/ui element (<desk-button> …),
// a base.css kit class on a native control (.desk-btn, .desk-field, .desk-check, .desk-tab …), or the
// shell's kit (.btn, .input, .icon-button, .segment, .menu-item …). They all read the component tokens,
// so the design system in force restyles them all. This counts native <button>, <input>, <select> and
// <textarea> that carry none of those classes, in a plugin's pages and scripts, the shell, @endue-ai/ui
// and the examples; @endue-ai/ui itself is left out, its controls being the components' own insides.
// Hidden, file, range and colour inputs have no component and are not counted; a
// `ds: own` comment on the line (or the line before) marks a control that draws a file's own content.
//
//   node scripts/ds-lint.mjs            check every target against its baseline (just check)
//   node scripts/ds-lint.mjs --update   write the baselines as the code stands
//   node scripts/ds-lint.mjs --list     print every finding
//
// Ratchet, as ui-lint's: scripts/ds-lint-baseline/<target>.json holds how many a target may still have.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, targets } from "./ui-lint.mjs";

export const BASELINES = join(ROOT, "scripts/ds-lint-baseline");
const MARKER = /ds:\s*own/;
const SKIP_DIRS = new Set(["vendor", "node_modules", "dist", "tests", "e2e", "lib", "test-dom"]);
const CONTROLS = "button|input|select|textarea";
/** The classes that make a native control a design system component. */
export const KIT = new Set([
  "desk-btn",
  "desk-icon-btn",
  "desk-field",
  "desk-check",
  "desk-tab",
  "desk-row",
  "btn",
  "icon-button",
  "add-button",
  "input",
  "segment",
  "menu-item",
]);
/** Inputs with no component in the catalogue: nothing on screen, or a picker the OS draws. */
const EXEMPT_TYPES = /\btype\s*[:=]\s*["'`]?(hidden|file|range|color)\b/;

function files(root, dir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(path);
      } else if (/\.(html|js|ts)$/.test(name) && !/\.(test|spec)\.[jt]s$|\.d\.ts$/.test(name)) {
        out.push(path);
      }
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
  return out;
}

/** Whether `text` (a tag's attributes or a call's next lines) names a kit class. */
export function hasKit(text) {
  const classes = [
    ...text.matchAll(/class(?:Name)?\s*[:=]\s*(["'`])((?:\\.|(?!\1).)*)\1/g),
    ...text.matchAll(/classList\.(?:add|toggle)\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g),
  ].flatMap((match) => match[2].split(/[\s${}]+/));
  return classes.some((name) => KIT.has(name));
}

/**
 * What says how a made control is classed: for `h("button", { … })` and its kind, the props object;
 * for `x = createElement("button")`, its line and the next lines that set `x.` something.
 */
function callWindow(source, at, call) {
  const rest = source.slice(at + call.length);
  if (!call.startsWith("createElement")) {
    const comma = rest.search(/\S/);
    if (rest[comma] !== ",") return "";
    const brace = comma + 1 + rest.slice(comma + 1).search(/\S/);
    if (rest[brace] !== "{") return "";
    let depth = 0;
    for (let i = brace; i < rest.length; i++) {
      if (rest[i] === "{") depth++;
      else if (rest[i] === "}" && --depth === 0) return rest.slice(brace, i + 1);
    }
    return rest.slice(brace);
  }
  const start = source.lastIndexOf("\n", at) + 1;
  const [line = "", ...next] = source.slice(start).split("\n").slice(0, 7);
  const name = /(\w+)\s*=\s*(?:document\.)?createElement/.exec(line)?.[1];
  const set = name ? next.filter((l) => new RegExp(`\\b${name}\\.`).test(l)) : [];
  return [line, ...set].join("\n");
}

/** Findings in one file's source: { line, rule: "control", text }. */
export function lintSource(source) {
  const lines = source.split("\n");
  const findings = [];
  const marked = (line) => MARKER.test(lines[line - 1] ?? "") || MARKER.test(lines[line - 2] ?? "");
  const lineAt = (at) => source.slice(0, at).split("\n").length;
  const report = (at, text) => {
    const line = lineAt(at);
    if (!marked(line))
      findings.push({ line, rule: "control", text: text.replace(/\s+/g, " ").slice(0, 80) });
  };
  // A tag in a page or in a string: its own attributes say whether it is a component.
  for (const match of source.matchAll(new RegExp(`<(${CONTROLS})\\b([^<>]*)>`, "g"))) {
    const attributes = match[2] ?? "";
    if (EXEMPT_TYPES.test(attributes) || hasKit(attributes.replace(/class=/g, "class:"))) continue;
    report(match.index, match[0]);
  }
  // A control a script makes: the call and the few lines after it say how it is classed.
  const made = new RegExp(
    `(?:createElement\\(\\s*|\\b(?:h|el|element|make|node)\\(\\s*)(["'\`])(${CONTROLS})\\1`,
    "g",
  );
  for (const match of source.matchAll(made)) {
    const window = callWindow(source, match.index, match[0]);
    if (EXEMPT_TYPES.test(window) || hasKit(window)) continue;
    report(match.index, match[0]);
  }
  return findings;
}

/** Every finding of one target, as { file, line, rule, text }. */
export function lintTarget(target, root = ROOT) {
  return target.dirs
    .flatMap((dir) => files(root, dir))
    .flatMap((path) =>
      lintSource(readFileSync(path, "utf8")).map((f) => ({
        file: relative(root, path).split(sep).join("/"),
        ...f,
      })),
    );
}

const baselinePath = (name, dir) => join(dir, `${name}.json`);
export function readBaseline(name, dir = BASELINES) {
  const path = baselinePath(name, dir);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).control ?? 0) : 0;
}

/** More controls than the baseline allows fail; fewer only ask for a lower baseline. */
export function compare(name, have, allowed) {
  if (have > allowed)
    return {
      problem: `${name}: ${have} native control(s) outside the design system, baseline allows ${allowed}`,
    };
  if (have < allowed)
    return { note: `${name}: ${have} native control(s), below the baseline's ${allowed}` };
  return {};
}

export function run(argv = process.argv.slice(2), root = ROOT, dir = BASELINES) {
  const update = argv.includes("--update");
  const list = argv.includes("--list");
  const problems = [];
  const notes = [];
  let left = 0;
  // @endue-ai/ui is the design system: the native controls inside its elements are the components.
  for (const target of targets(root).filter((t) => t.name !== "_ui")) {
    const findings = lintTarget(target, root);
    left += findings.length;
    if (list) for (const f of findings) console.log(`${f.file}:${f.line}  ${f.text}`);
    if (update) {
      const path = baselinePath(target.name, dir);
      if (findings.length === 0) rmSync(path, { force: true });
      else writeFileSync(path, `${JSON.stringify({ control: findings.length }, null, 2)}\n`);
      continue;
    }
    const { problem, note } = compare(target.name, findings.length, readBaseline(target.name, dir));
    if (problem) problems.push(problem);
    if (note) notes.push(note);
  }
  for (const note of notes)
    console.log(`ds-lint: ${note} (lower it: node scripts/ds-lint.mjs --update)`);
  for (const problem of problems) console.error(`ds-lint: ${problem}`);
  if (problems.length === 0)
    console.log(`ds-lint: every target within its baseline (${left} native controls left)`);
  return problems.length === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && !run()) process.exit(1);
