import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkDeclaration,
  compare,
  count,
  lintCss,
  lintHtml,
  lintJs,
  lintPlugin,
  targets,
} from "./ui-lint.mjs";

test("colours come from tokens: literals fail, var() and color-mix of tokens pass", () => {
  assert.deepEqual(checkDeclaration("color", "#fff"), ["color"]);
  assert.deepEqual(checkDeclaration("background", "rgba(0, 0, 0, 0.4)"), ["color"]);
  assert.deepEqual(checkDeclaration("border", "1px solid oklch(0.7 0.1 250)"), ["color"]);
  assert.deepEqual(checkDeclaration("background-color", "white"), ["color"]);
  assert.deepEqual(checkDeclaration("--accent-ink", "#123456"), ["color"]);
  assert.deepEqual(checkDeclaration("color", "var(--desk-text)"), []);
  assert.deepEqual(checkDeclaration("color", "var(--desk-text, #141416)"), []);
  assert.deepEqual(
    checkDeclaration("background", "color-mix(in srgb, var(--desk-text) 8%, transparent)"),
    [],
  );
  assert.deepEqual(checkDeclaration("fill", "url(#fade)"), []);
  assert.deepEqual(checkDeclaration("box-shadow", "0 0 0 2px var(--desk-ring)"), []);
  assert.deepEqual(checkDeclaration("background", "transparent"), []);
});

test("fonts, sizes, radii and durations come from tokens", () => {
  assert.deepEqual(checkDeclaration("font-family", "Menlo, monospace"), ["font"]);
  assert.deepEqual(checkDeclaration("font-family", "var(--desk-font-mono)"), []);
  assert.deepEqual(checkDeclaration("font", "13px/1.5 system-ui"), ["font", "size"]);
  assert.deepEqual(checkDeclaration("font", "var(--desk-text-sm)/1.5 var(--desk-font-sans)"), []);
  assert.deepEqual(checkDeclaration("font", "inherit"), []);
  assert.deepEqual(checkDeclaration("font-size", "12px"), ["size"]);
  assert.deepEqual(checkDeclaration("font-size", "0.9em"), []);
  assert.deepEqual(checkDeclaration("font-size", "calc(var(--desk-text-sm) - 1px)"), []);
  assert.deepEqual(checkDeclaration("border-radius", "6px"), ["radius"]);
  assert.deepEqual(checkDeclaration("border-top-left-radius", "4px"), ["radius"]);
  assert.deepEqual(checkDeclaration("border-radius", "0"), []);
  assert.deepEqual(checkDeclaration("border-radius", "50%"), []);
  assert.deepEqual(checkDeclaration("border-radius", "calc(var(--desk-radius-md) - 2px)"), []);
  assert.deepEqual(checkDeclaration("transition", "opacity 120ms ease"), ["duration"]);
  assert.deepEqual(checkDeclaration("animation", "spin 1s linear infinite"), ["duration"]);
  assert.deepEqual(checkDeclaration("transition", "opacity var(--desk-motion-fast) ease"), []);
  assert.deepEqual(checkDeclaration("transition", "none 0s"), []);
});

test("stylesheets: declarations with their lines; selectors and comments are not values", () => {
  const css = [
    "#feed:hover {", // a selector that looks like a colour
    "  color: #fff;",
    "  /* background: #000; */",
    "  border-radius: var(--desk-radius-md);",
    "}",
  ].join("\n");
  assert.deepEqual(
    lintCss(css).map(({ line, rule }) => [line, rule]),
    [[2, "color"]],
  );
});

test("a theme: content comment exempts a declaration, or a whole rule from its opening line", () => {
  const css = [
    ".page { /* theme: content */",
    "  color: #000;",
    "  background: #fff;",
    "}",
    ".mark { background: #ff0; /* theme: content */ }",
    ".ui { color: #333; }",
  ].join("\n");
  assert.deepEqual(
    lintCss(css).map(({ line, rule }) => [line, rule]),
    [[6, "color"]],
  );
});

test("scripts: colour literals inside strings, unless marked", () => {
  const js = [
    'el.style.color = "#c00";',
    'const shadow = "0 1px 2px rgba(0,0,0,.3)";',
    "// theme: content (Word's highlight colours)",
    'const yellow = "#FFFF00";',
    'const id = "#feed-list";',
    'const fine = "var(--desk-primary)";',
    "/* a comment with #fff */",
  ].join("\n");
  assert.deepEqual(
    lintJs(js).map(({ line }) => line),
    [1, 2],
  );
});

test("pages: <style> blocks and style attributes, at their lines", () => {
  const html = [
    "<html>",
    "<style>",
    "body { color: #111; }",
    "</style>",
    '<p style="font-size: 12px">',
  ].join("\n");
  assert.deepEqual(
    lintHtml(html).map(({ line, rule }) => [line, rule]),
    [
      [3, "color"],
      [5, "size"],
    ],
  );
});

test("the ratchet fails above and below the baseline, and passes when they match", () => {
  const findings = [{ rule: "color" }, { rule: "color" }, { rule: "radius" }];
  assert.deepEqual(count(findings), { color: 2, radius: 1 });
  assert.deepEqual(compare("x", { color: 2, radius: 1 }, { color: 2, radius: 1 }), []);
  assert.equal(compare("x", { color: 3 }, { color: 2 }).length, 1);
  assert.match(compare("x", { color: 1 }, { color: 2 })[0], /--update/);
  assert.equal(compare("x", { color: 1 }, {}).length, 1);
});

test("plugins are linted by their ui folder, vendored code left out", () => {
  const root = mkdtempSync(join(tmpdir(), "ui-lint-"));
  mkdirSync(join(root, "plugins/demo/ui/vendor"), { recursive: true });
  writeFileSync(join(root, "plugins/demo/ui/style.css"), ".a { color: #abc; }\n");
  writeFileSync(join(root, "plugins/demo/ui/vendor/lib.css"), ".b { color: #def; }\n");
  writeFileSync(join(root, "plugins/demo/ui/main.js"), 'const c = "#fff";\n');
  const findings = lintPlugin("demo", root);
  assert.deepEqual(
    findings.map(({ file, rule }) => [file, rule]),
    [
      ["plugins/demo/ui/main.js", "color"],
      ["plugins/demo/ui/style.css", "color"],
    ],
  );
  assert.deepEqual(
    targets(root).map((t) => t.name),
    ["demo", "_runtime", "_ui", "_examples"],
  );
});
