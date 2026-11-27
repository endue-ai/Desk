import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BASELINE, compare, count, scan } from "./copy-lint.mjs";

test("count finds each inline comparison with the Korean language", () => {
  assert.equal(count(`const a = lang === "ko" ? "예" : "yes";`), 1);
  assert.equal(count(`if ('ko' == lang) x(); if (lang !== "ko") y();`), 2);
  assert.equal(count(`const t = copy[key][language === "ko" ? 0 : 1];`), 1);
  assert.equal(count(`messageText(catalogs, lang, "frames.stop")`), 0);
  assert.equal(count(`const ko = { stop: "멈추기" };`), 0);
});

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "copy-lint-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("scan reads sources under packages, apps/desk/src and plugins, not tests or vendored code", () => {
  const root = tree({
    "packages/runtime/src/a.ts": `x(lang === "ko");`,
    "packages/runtime/src/a.test.ts": `x(lang === "ko");`,
    "apps/desk/src/b.ts": `x(lang === "ko"); y(lang === "ko");`,
    "plugins/notes/ui/c.js": `x(lang === "ko");`,
    "plugins/notes/ui/vendor/d.js": `x(lang === "ko");`,
    "packages/ui/node_modules/e/f.js": `x(lang === "ko");`,
    "packages/runtime/src/clean.ts": `x(1);`,
  });
  assert.deepEqual(scan(root), {
    "apps/desk/src/b.ts": 2,
    "packages/runtime/src/a.ts": 1,
    "plugins/notes/ui/c.js": 1,
  });
});

test('a new inline lang === "ko" pair fails', () => {
  const problems = compare({ "packages/runtime/src/new.ts": 1 }, {});
  assert.equal(problems.length, 1);
  assert.match(problems[0], /packages\/runtime\/src\/new\.ts/);
  assert.match(problems[0], /catalog/);
});

test("a baseline file at or under its count passes", () => {
  assert.deepEqual(compare({ "a.ts": 3, "b.ts": 1 }, { "a.ts": 3, "b.ts": 2 }), []);
});

test("a baseline file whose count grows fails", () => {
  const problems = compare({ "a.ts": 4 }, { "a.ts": 3 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /a\.ts.*4.*3/);
});

test("a file that dropped to zero must leave the baseline", () => {
  const problems = compare({}, { "gone.ts": 2 });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /gone\.ts/);
  assert.match(problems[0], /--update/);
});

test('no surface source holds an inline "ko" pair and the baseline names none (#361)', () => {
  const surface = (files) =>
    Object.keys(files).filter((file) => file.startsWith("packages/runtime/src/surface/"));
  assert.deepEqual(surface(scan()), []);
  assert.deepEqual(surface(JSON.parse(readFileSync(BASELINE, "utf8"))), []);
});
