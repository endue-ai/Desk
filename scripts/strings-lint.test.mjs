import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findings, scan, VIEW, views } from "./strings-lint.mjs";

const texts = (src) => findings(src).map((f) => f.text);

test("a view module is view.js, view-*.js or *-view.js", () => {
  for (const path of ["ui/view.js", "ui/view-grid.js", "ui/chart/view.js", "ui/x/keys-view.js"])
    assert.ok(VIEW.test(path), path);
  for (const path of ["ui/views.js", "ui/preview.js", "ui/viewer.js", "ui/view-grid.ts"])
    assert.ok(!VIEW.test(path), path);
});

test("a literal with a capital word, two words, or a word and a placeholder is the person's words", () => {
  assert.deepEqual(texts(`el(doc, "button", {}, "Run");`), ["Run"]);
  assert.deepEqual(texts(`note.textContent = "Not connected";`), ["Not connected"]);
  assert.deepEqual(texts(`const why = "no rows here";`), ["no rows here"]);
  assert.deepEqual(texts(`const line = \`\${n} rows\`;`), ["{} rows"]);
  assert.deepEqual(texts(`const line = \`\${n} column\${n === 1 ? '' : 's'}\`;`), ["{} column{}"]);
});

test("what goes straight into the page is words with any letter in it", () => {
  assert.deepEqual(texts(`badge.textContent = "read-only";`), ["read-only"]);
  assert.deepEqual(texts(`input.placeholder = ok ? "integer" : "";`), ["integer"]);
  assert.deepEqual(texts(`el(doc, "input", { "aria-label": "value" });`), ["value"]);
  assert.deepEqual(texts(`node.title = "{}";`), []);
});

test("a template's parts are words with it", () => {
  assert.deepEqual(texts(`const s = \`\${n} value\${n === 1 ? ' is' : 's are'} gone\`;`), [
    "{} value{} gone",
    " is",
    "s are",
  ]);
  assert.deepEqual(texts(`const s = \`Sorted \${dir === 'asc' ? 'up' : 'down'}\`;`), [
    "Sorted {}",
    "up",
    "down",
  ]);
});

test("identifiers, keys, classes, styles, selectors and comparisons are not words", () => {
  const source = `
    import { el } from "./dom.js";
    const a = { "Not a word": 1, kind: "console" };
    if (event.key === "Enter" || "Escape" === key) run("editCell");
    switch (mode) { case "Manual commit": break; }
    el(doc, "div", { class: "desk-btn desk-btn-quiet", style: \`left: \${x}px; width: 2px\` });
    node.className = on ? \`tag tag-\${tag}\` : "tag";
    form.querySelector("input, select, textarea, button");
    if ("error" in answer) node.setAttribute("aria-label", t("grid.label"));
    const keys = ["Enter", "Tab"];
    const id = \`fk:\${i}:cols\`;
    const option = { value: "by default", label: t("x.y") };
    // A comment that says "Run this" is not code.
    /* Nor "this one". */
    const re = /Run it now/u;
  `;
  assert.deepEqual(texts(source), []);
});

test("each finding names its line", () => {
  assert.deepEqual(findings(`const a = 1;\nconst b = "Two words";\n`), [
    { line: 2, text: "Two words" },
  ]);
});

test("scan reads model modules and static markup as well as view modules, except vendor", () => {
  const root = mkdtempSync(join(tmpdir(), "strings-lint-"));
  const files = {
    "p/ui/view.js": `el(doc, "p", {}, "No rows.");`,
    "p/ui/grid/keys-view.js": `const ok = "fine";`,
    "p/ui/model.js": `const label = "empty"; const query = "SELECT name FROM users";`,
    "p/ui/index.html": `<!doctype html><p>Empty view</p><button aria-label="refresh"></button>`,
    "p/ui/vendor/view.js": `const words = "Vendored";`,
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  assert.deepEqual(views(root, ["p/ui"]), ["p/ui/grid/keys-view.js", "p/ui/view.js"]);
  assert.deepEqual(scan(root, ["p/ui"]), [
    'p/ui/index.html:1: "Empty view"',
    'p/ui/index.html:1: "refresh"',
    'p/ui/model.js:1: "empty"',
    'p/ui/view.js:1: "No rows."',
  ]);
});

test("the database plugin's modules and markup hold no literal a person reads", () => {
  assert.ok(views().length >= 29);
  assert.deepEqual(scan(), []);
});
