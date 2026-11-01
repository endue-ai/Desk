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

  it("vendored modules carry no source map comment", () => {
    for (const name of Object.keys(expected()).filter((n) => n.endsWith(".mjs"))) {
      assert.doesNotMatch(readFileSync(join(VENDOR, name), "utf8"), /sourceMappingURL/u, name);
    }
  });
});
