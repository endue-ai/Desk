import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { committed, expected, PACKAGE, PLUGIN, VENDOR, version } from "./vendor-novnc.mjs";

describe("vendor-novnc", () => {
  it("the committed copy in plugins/screens/ui/vendor/novnc matches the pinned package", () => {
    const files = expected();
    assert.deepEqual(committed(), Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) {
      assert.equal(readFileSync(join(VENDOR, name), "utf8"), text, `${name} differs`);
    }
  });

  it("the plugin pins noVNC to one exact version", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
    assert.equal(manifest.devDependencies[PACKAGE], version());
    assert.match(version(), /^\d+\.\d+\.\d+$/u);
  });

  it("carries the MPL-2.0 text and pako's licence beside the code, and the RFB entry", () => {
    const files = Object.keys(expected());
    for (const name of [
      "LICENSE.txt",
      "docs/LICENSE.MPL-2.0",
      "vendor/pako/LICENSE",
      "core/rfb.js",
    ]) {
      assert.ok(files.includes(name), name);
    }
  });

  it("imports only inside the copy: no bare specifier the plugin frame could not resolve", () => {
    for (const name of Object.keys(expected()).filter((n) => n.endsWith(".js"))) {
      const text = readFileSync(join(VENDOR, name), "utf8");
      assert.doesNotMatch(text, /^import [^;]* from ["'][^./]/mu, name);
    }
  });
});
