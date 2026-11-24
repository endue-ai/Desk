import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const oldName = /\bDesk\b/u;

test("governance and the core overview use the current product name", () => {
  for (const path of ["GOVERNANCE.md", "crates/desk-core/README.md"]) {
    const text = read(path);
    assert.ok(!oldName.test(text), `${path} contains the earlier product name`);
    assert.match(text, /\bendue\b/u);
  }
  const core = read("crates/desk-core/README.md");
  assert.ok(core.trimEnd().split("\n").length <= 40, "the package overview must fit in 40 lines");
  assert.match(core, /## Public API/u);
  assert.match(core, /cargo test -p desk-core/u);
});

test("the English and Korean roadmaps use endue in titles, text and diagrams", () => {
  for (const [path, title] of [
    ["docs/roadmap.md", "# endue roadmap"],
    ["docs/ko/desk-roadmap.md", "# endue 로드맵"],
  ]) {
    const text = read(path);
    assert.equal(text.split("\n", 1)[0], title);
    assert.ok(!oldName.test(text), `${path} contains the earlier product name`);
  }
});

test("Korean design and requirements headings use the current product name", () => {
  for (const name of readdirSync(new URL("docs/ko/", root))) {
    if (!name.endsWith(".md")) continue;
    const [title] = read(`docs/ko/${name}`).split("\n", 1);
    assert.ok(!oldName.test(title), `${name} uses the earlier product name in its title`);
  }
  assert.match(read("docs/ko/desk-structure.md"), /^# endue 구조$/mu);
});

test("the screen reader guide names the window, shell group and list exposed by endue", () => {
  const guide = read("docs/qa/accessibility.md");
  for (const label of ["the window `endue`", "`endue` group", "`Windows`"]) {
    assert.ok(guide.includes(label), `the accessibility guide is missing ${label}`);
  }
  assert.ok(!oldName.test(guide), "the guide gives an earlier accessibility label");
});
