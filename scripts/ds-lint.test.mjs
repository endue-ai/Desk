import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { compare, hasKit, lintSource, run } from "./ds-lint.mjs";

const lines = (source) => lintSource(source).map((f) => f.line);

describe("ds-lint", () => {
  it("counts native controls a page or a string writes without a design system class", () => {
    const page = [
      '<button class="desk-btn desk-btn-primary">Save</button>',
      '<button class="toolbar-thing">Odd</button>',
      '<input class="desk-field" type="search">',
      '<input type="checkbox">',
      '<input type="file" hidden>',
      '<select class="desk-field"></select>',
      "<textarea></textarea>",
      '<button class="tab">Plain</button> <!-- ds: own -->',
    ].join("\n");
    assert.deepEqual(lines(page), [2, 4, 7]);
  });

  it("counts controls a script makes unless the next lines give them a kit class", () => {
    const script = [
      'const ok = document.createElement("button");',
      'ok.className = "desk-btn";',
      'const odd = document.createElement("button");',
      'odd.className = "pill";',
      'const shell = h("button", { class: "btn btn-outline" }, "Use");',
      'const own = h("button", { class: "mode-dot" });',
      'const pick = h("input", { type: "file", class: "sr-only" });',
      "// ds: own",
      'const cell = el("input", { class: "cell-editor" });',
      'const send = element("button", "desk-btn desk-btn-primary", "Send");',
      'const plain = element("button", "pill", "Later");',
      'const tab = doc.createElement("button");',
      'tab.className = "desk-tab";',
      'const b = el("button", words);',
      'b.className = "desk-btn";',
      'const c = make("button", label);',
    ].join("\n");
    assert.deepEqual(lines(script), [3, 6, 11, 16]);
  });

  it("reads class names out of attributes, className, classList and class props", () => {
    assert.ok(hasKit('class="a desk-tab b"'));
    assert.ok(hasKit('x.classList.add("menu-item")'));
    assert.ok(hasKit("{ class: `segment is-on` }"));
    assert.ok(!hasKit('class="desk-tabs"'));
    assert.ok(!hasKit('class="input-wrapper"'));
  });

  it("fails above the baseline and only notes below it", () => {
    assert.match(compare("notes", 2, 1).problem, /notes: 2 native control/);
    assert.match(compare("notes", 0, 1).note, /below the baseline's 1/);
    assert.deepEqual(compare("notes", 1, 1), {});
  });

  it("passes this repository against its baselines", () => {
    assert.equal(run([]), true);
  });

  it("holds a target with no baseline at zero", () => {
    const root = mkdtempSync(join(tmpdir(), "ds-lint-"));
    for (const dir of ["plugins/demo/ui", "packages/runtime/src", "packages/ui/src", "examples"])
      mkdirSync(join(root, dir), { recursive: true });
    const baselines = join(root, "baselines");
    mkdirSync(baselines);
    writeFileSync(join(root, "plugins/demo/ui/index.html"), '<button class="odd">Go</button>\n');
    assert.equal(run([], root, baselines), false);
    writeFileSync(
      join(root, "plugins/demo/ui/index.html"),
      '<button class="desk-btn">Go</button>\n',
    );
    assert.equal(run([], root, baselines), true);
  });
});
