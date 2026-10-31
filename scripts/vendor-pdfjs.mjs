// Copies the reader plugin's PDF engine, pdf.js, from the npm package the lockfile pins into
// plugins/reader/ui/vendor: the minified ES modules, the text and annotation layer rules of its
// viewer stylesheet, its licence and a VERSIONS file (ADR 0042, as ADR 0037 does for xterm.js).
// Its test checks the committed copy matches, like codegen-check.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PLUGIN = join(ROOT, "plugins/reader");
export const VENDOR = join(PLUGIN, "ui/vendor");
export const PACKAGE = "pdfjs-dist";

/** The package's files, by the name they get in ui/vendor. */
export const FILES = {
  "pdf.min.mjs": "build/pdf.min.mjs",
  "pdf.worker.min.mjs": "build/pdf.worker.min.mjs",
  LICENSE: "LICENSE",
};

/** The viewer stylesheet's top-level rules the reader needs: the text and annotation layers. */
export const LAYERS = [".textLayer", ".textLayerImages", ".annotationLayer"];

const require = createRequire(join(PLUGIN, "package.json"));
const packageDir = () => dirname(require.resolve(`${PACKAGE}/package.json`));

export function version() {
  return JSON.parse(readFileSync(join(packageDir(), "package.json"), "utf8")).version;
}

/** The source map comment goes: the maps are not vendored, so it would only point at a 404. */
function strip(text) {
  return text.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/u, "\n");
}

/** Split a stylesheet into its top-level rules (comments kept with the rule after them). */
function rules(css) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      i = css.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (c === '"' || c === "'") {
      i = css.indexOf(c, i + 1);
      continue;
    }
    if (c === "{") depth++;
    if (c === "}" && --depth === 0) {
      out.push(css.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  return out;
}

/** The licence header and the layer rules of web/pdf_viewer.css. */
export function layers() {
  const css = readFileSync(join(packageDir(), "web/pdf_viewer.css"), "utf8");
  const header = css.slice(0, css.indexOf("*/") + 2);
  const picked = rules(css.slice(header.length)).filter((rule) => {
    const selector = rule.slice(0, rule.indexOf("{")).trim();
    return LAYERS.includes(selector);
  });
  const note = `/* The text and annotation layer rules of pdfjs-dist ${version()} web/pdf_viewer.css, copied by scripts/vendor-pdfjs.mjs. */`;
  return `${header}\n\n${note}\n\n${picked.join("\n\n")}\n`;
}

/** What ui/vendor must hold: file name -> text. */
export function expected() {
  const files = {};
  for (const [target, source] of Object.entries(FILES)) {
    const text = readFileSync(join(packageDir(), source), "utf8");
    files[target] = target.endsWith(".mjs") ? strip(text) : text;
  }
  files["pdf_layers.css"] = layers();
  files.VERSIONS = `${PACKAGE} ${version()}\n`;
  return files;
}

export function vendor() {
  mkdirSync(VENDOR, { recursive: true });
  const files = expected();
  for (const name of readdirSync(VENDOR)) if (!(name in files)) rmSync(join(VENDOR, name));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(VENDOR, name), text);
  return Object.keys(files).sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const name of vendor()) console.log(`vendored ${name}`);
}
