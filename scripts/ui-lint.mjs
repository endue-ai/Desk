#!/usr/bin/env node
// ui-lint: theme conformance (docs/ko/theme-requirements.md, TP). Desk's UI reads every colour, font,
// text size, corner radius and duration from the theme's --desk-* tokens, so a theme reaches all of it: the
// shell, @endue-ai/ui, the examples and every plugin page. A literal is allowed only where a
// `theme: content` comment marks it: the colours of a file's own content (a document's text, an
// image's checkerboard), which a theme must not change.
//
//   node scripts/ui-lint.mjs            check every target against its baseline (just check)
//   node scripts/ui-lint.mjs --update   write the baselines as the code stands
//   node scripts/ui-lint.mjs --list     print every finding
//
// Ratchet: scripts/ui-lint-baseline/<target>.json holds the counts a target still has. A target with
// no baseline must have none; counts above the baseline fail, and so do counts below it, until the
// baseline is lowered with --update (or deleted once it reaches zero).
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const BASELINES = join(ROOT, "scripts/ui-lint-baseline");
export const RULES = ["color", "font", "size", "radius", "duration"];
const MARKER = /theme:\s*content/;
const SKIP_DIRS = new Set(["vendor", "node_modules", "dist", "tests", "e2e", "lib"]);

/** Every target: each plugin with a ui/ folder, then the shell, @endue-ai/ui and the examples. */
export function targets(root = ROOT) {
  const plugins = readdirSync(join(root, "plugins"))
    .filter((name) => existsSync(join(root, "plugins", name, "ui")))
    .sort()
    .map((name) => ({ name, dirs: [join("plugins", name, "ui")] }));
  return [
    ...plugins,
    { name: "_runtime", dirs: ["packages/runtime/src"] },
    { name: "_ui", dirs: ["packages/ui/src"] },
    { name: "_examples", dirs: ["examples"] },
  ];
}

function files(root, dir) {
  const out = [];
  const walk = (abs) => {
    for (const name of readdirSync(abs).sort()) {
      const path = join(abs, name);
      if (statSync(path).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(path);
      } else if (/\.(css|html)$/.test(name) || (/\.js$/.test(name) && !/\.test\.js$/.test(name))) {
        out.push(path);
      }
    }
  };
  if (existsSync(join(root, dir))) walk(join(root, dir));
  // The token definitions themselves are where literals belong (any separator: Windows too).
  return out.filter((path) => !/packages[\\/]ui[\\/]src[\\/]tokens\.css$/.test(path));
}

const NAMED = new Set(
  "white black red green blue gray grey yellow orange purple pink silver navy teal maroon olive lime aqua fuchsia brown gold indigo violet crimson coral salmon tomato".split(
    " ",
  ),
);
const COLOR_PROPS =
  /^(--.*|color|background(-color)?|border(-(top|right|bottom|left|block|inline))?(-color)?|outline(-color)?|fill|stroke|caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|box-shadow|text-shadow|scrollbar-color)$/;
const COLOR_FN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;
const HEX = /#[0-9a-fA-F]{3,8}\b/;

const withoutUrls = (value) => value.replace(/url\([^)]*\)/g, "url()");
const withoutVars = (value) => {
  let out = value;
  for (let i = 0; i < 8 && out.includes("var("); i++) out = out.replace(/var\([^()]*\)/g, "");
  return out;
};

/** The rules a CSS declaration breaks. */
export function checkDeclaration(property, rawValue) {
  const prop = property.trim().toLowerCase();
  const value = withoutUrls(rawValue.trim());
  const bare = withoutVars(value).toLowerCase();
  const broken = [];
  const colorish = COLOR_PROPS.test(prop);
  if (
    HEX.test(bare) ||
    COLOR_FN.test(bare.replace(/color-mix\(/g, "")) ||
    (colorish && bare.split(/[^a-z]+/).some((word) => NAMED.has(word)))
  ) {
    broken.push("color");
  }
  if (prop === "font-family" && !/^(var\(|inherit|initial|unset)/.test(value)) broken.push("font");
  if (prop === "font" && !/var\(--desk-font|^(inherit|initial|unset)$/.test(value))
    broken.push("font");
  const absolute = /(^|[\s(,])(\d*\.)?\d+(px|pt|rem)\b/;
  if (prop === "font-size" && !value.includes("var(--desk-text") && absolute.test(bare))
    broken.push("size");
  if (prop === "font" && !value.includes("var(--desk-text") && absolute.test(bare.split("/")[0]))
    broken.push("size");
  if (/^border(-[a-z]+)*-radius$/.test(prop) && !value.includes("var(--desk-radius")) {
    if (/(^|[\s(,/-])(\d*\.)?\d+(px|em|rem)\b/.test(bare) && !/^0(px)?$/.test(bare.trim()))
      broken.push("radius");
  }
  if (/^(transition|animation)(-duration|-delay)?$/.test(prop)) {
    if (/(^|[\s,(])(\d*\.)?\d*[1-9]\d*(\.\d+)?m?s\b/.test(bare)) broken.push("duration");
  }
  return broken;
}

/** Findings in a stylesheet: { line, rule, text }. `offset` shifts line numbers (for <style>). */
export function lintCss(source, offset = 0) {
  const findings = [];
  const markers = new Set();
  // Blank the comments but keep their lines; remember the lines that carry the marker.
  const text = source.replace(/\/\*[\s\S]*?\*\//g, (comment, at) => {
    const line = source.slice(0, at).split("\n").length;
    if (MARKER.test(comment)) markers.add(line);
    return comment.replace(/[^\n]/g, " ");
  });
  const lines = text.split("\n");
  // A marker alone on the line before a rule's opening line covers the rule.
  const above = (line) => markers.has(line - 1) && (lines[line - 2] ?? "").trim() === "";
  const lineOf = (at) => text.slice(0, at).split("\n").length;
  const exempt = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const line = lineOf(i);
      exempt.push(exempt.at(-1) || markers.has(line) || above(line));
      start = i + 1;
    } else if (ch === "}" || ch === ";") {
      const decl = text.slice(start, i);
      const colon = decl.indexOf(":");
      if (colon > 0) {
        const line = lineOf(start + decl.search(/\S/));
        const skip = exempt.at(-1) || markers.has(line) || markers.has(lineOf(i));
        if (!skip)
          for (const rule of checkDeclaration(decl.slice(0, colon), decl.slice(colon + 1)))
            findings.push({ line: line + offset, rule, text: decl.trim().replace(/\s+/g, " ") });
      }
      if (ch === "}") exempt.pop();
      start = i + 1;
    }
  }
  return findings;
}

/** Findings in a script: colour literals inside strings. */
export function lintJs(source) {
  const findings = [];
  const lines = source.split("\n");
  let inBlock = false;
  lines.forEach((raw, index) => {
    let code = raw;
    if (inBlock) {
      const end = code.indexOf("*/");
      if (end < 0) return;
      code = code.slice(end + 2);
      inBlock = false;
    }
    code = code.replace(/\/\*.*?\*\//g, "");
    const open = code.indexOf("/*");
    if (open >= 0) {
      inBlock = true;
      code = code.slice(0, open);
    }
    const before = (lines[index - 1] ?? "").trim();
    if (MARKER.test(raw) || (MARKER.test(before) && /^(\/\/|\/\*|\*)/.test(before))) return;
    const strings = code.match(/(["'`])(?:\\.|(?!\1).)*\1/g) ?? [];
    for (const literal of strings) {
      const inner = withoutUrls(literal.slice(1, -1));
      if (
        /^#[0-9a-fA-F]{3,8}$/.test(inner) ||
        /(^|[\s:(,])#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?\b/.test(inner) ||
        COLOR_FN.test(withoutVars(inner).replace(/color-mix\(/g, ""))
      ) {
        findings.push({ line: index + 1, rule: "color", text: literal.slice(0, 80) });
      }
    }
  });
  return findings;
}

/** Findings in a page: its <style> blocks and style="" attributes. */
export function lintHtml(source) {
  const findings = [];
  const lineAt = (at) => source.slice(0, at).split("\n").length;
  for (const match of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const at = match.index + match[0].indexOf(match[1]);
    findings.push(...lintCss(match[1], lineAt(at) - 1));
  }
  for (const match of source.matchAll(/\sstyle="([^"]*)"/g)) {
    findings.push(...lintCss(`x{${match[1]}}`, lineAt(match.index) - 1));
  }
  return findings;
}

/** Every finding of one target, as { file, line, rule, text }. */
export function lintTarget(target, root = ROOT) {
  return files(root, ...target.dirs).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    const found = path.endsWith(".css")
      ? lintCss(source)
      : path.endsWith(".html")
        ? lintHtml(source)
        : lintJs(source);
    return found.map((f) => ({ file: relative(root, path).split(sep).join("/"), ...f }));
  });
}

/** The findings of one plugin by folder name (plugins/<name>/ui), for a plugin's own test. */
export function lintPlugin(name, root = ROOT) {
  return lintTarget({ name, dirs: [join("plugins", name, "ui")] }, root);
}

export const count = (findings) =>
  Object.fromEntries(
    RULES.map((rule) => [rule, findings.filter((f) => f.rule === rule).length]).filter(
      ([, n]) => n > 0,
    ),
  );

const baselinePath = (name, dir) => join(dir, `${name}.json`);
export function readBaseline(name, dir = BASELINES) {
  const path = baselinePath(name, dir);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
}

/** Compare counts to a baseline: problems as sentences, empty when they match. */
export function compare(name, counts, baseline) {
  const problems = [];
  for (const rule of RULES) {
    const have = counts[rule] ?? 0;
    const allowed = baseline[rule] ?? 0;
    if (have > allowed)
      problems.push(`${name}: ${have} ${rule} literal(s), baseline allows ${allowed}`);
    if (have < allowed)
      problems.push(
        `${name}: ${have} ${rule} literal(s), baseline still says ${allowed}: run node scripts/ui-lint.mjs --update`,
      );
  }
  return problems;
}

function main(args) {
  const results = targets().map((target) => ({ target, findings: lintTarget(target) }));
  if (args.includes("--list")) {
    for (const { findings } of results)
      for (const f of findings) console.log(`${f.file}:${f.line} ${f.rule} ${f.text}`);
    return 0;
  }
  if (args.includes("--update")) {
    for (const { target, findings } of results) {
      const counts = count(findings);
      const path = baselinePath(target.name, BASELINES);
      if (Object.keys(counts).length === 0) rmSync(path, { force: true });
      else writeFileSync(path, `${JSON.stringify(counts, null, 2)}\n`);
    }
    console.log("ui-lint: baselines written");
    return 0;
  }
  const problems = results.flatMap(({ target, findings }) =>
    compare(target.name, count(findings), readBaseline(target.name)),
  );
  for (const name of existsSync(BASELINES) ? readdirSync(BASELINES) : []) {
    if (!results.some(({ target }) => `${target.name}.json` === name))
      problems.push(`${name}: a baseline for a target that does not exist`);
  }
  if (problems.length > 0) {
    console.error(`ui-lint: FAIL\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    console.error("  (node scripts/ui-lint.mjs --list names each literal; docs/design-system.md)");
    return 1;
  }
  const left = results.reduce((n, { findings }) => n + findings.length, 0);
  console.log(`ui-lint: ${results.length} targets match their baselines (${left} literals left)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
