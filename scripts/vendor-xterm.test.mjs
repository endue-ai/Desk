import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expected, FILES, PLUGIN, VENDOR, versions } from "./vendor-xterm.mjs";

describe("vendor-xterm", () => {
  it("the committed copy in plugins/terminal/ui/vendor matches the pinned packages", () => {
    const files = expected();
    assert.deepEqual(readdirSync(VENDOR).sort(), Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) {
      assert.equal(readFileSync(join(VENDOR, name), "utf8"), text, `${name} differs`);
    }
  });

  it("the plugin pins every vendored package to one exact version", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
    const pinned = versions();
    for (const name of Object.keys(FILES)) {
      assert.equal(manifest.devDependencies[name], pinned[name], `${name} is not pinned`);
      assert.match(pinned[name], /^\d+\.\d+\.\d+$/u, `${name} has a range`);
    }
  });

  it("vendors the search and web links addons beside fit and unicode11, each with its licence", () => {
    const files = Object.keys(expected());
    for (const addon of ["fit", "unicode11", "search", "web-links"]) {
      assert.ok(files.includes(`addon-${addon}.mjs`), `addon-${addon}.mjs`);
      assert.ok(files.includes(`LICENSE.addon-${addon}`), `LICENSE.addon-${addon}`);
    }
    assert.match(expected().VERSIONS, /^@xterm\/addon-search \d+\.\d+\.\d+$/mu);
    assert.match(expected().VERSIONS, /^@xterm\/addon-web-links \d+\.\d+\.\d+$/mu);
  });

  it("vendored modules carry no source map comment", () => {
    for (const name of Object.keys(expected()).filter((n) => n.endsWith(".mjs"))) {
      assert.doesNotMatch(readFileSync(join(VENDOR, name), "utf8"), /sourceMappingURL/u, name);
    }
  });
});
