import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { expected, LAYERS, PACKAGE, PLUGIN, VENDOR, version } from "./vendor-pdfjs.mjs";

describe("vendor-pdfjs", () => {
  it("the committed copy in plugins/reader/ui/vendor matches the pinned package", () => {
    const files = expected();
    assert.deepEqual(readdirSync(VENDOR).sort(), Object.keys(files).sort());
    for (const [name, text] of Object.entries(files)) {
      assert.equal(readFileSync(join(VENDOR, name), "utf8"), text, `${name} differs`);
    }
  });

  it("the plugin pins pdf.js to one exact version, 6.4.299", () => {
    const manifest = JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8"));
    assert.equal(manifest.devDependencies[PACKAGE], version());
    assert.equal(version(), "6.4.299");
  });

  it("vendored modules carry no source map comment", () => {
    for (const name of Object.keys(expected()).filter((n) => n.endsWith(".mjs"))) {
      assert.doesNotMatch(readFileSync(join(VENDOR, name), "utf8"), /sourceMappingURL/u, name);
    }
  });

  it("the layer stylesheet holds the text and annotation layers and nothing that fetches", () => {
    const css = readFileSync(join(VENDOR, "pdf_layers.css"), "utf8");
    for (const selector of LAYERS) assert.match(css, new RegExp(`^\\${selector} \\{`, "mu"));
    assert.doesNotMatch(css, /\.xfaLayer|\.pdfViewer|@import/u);
    for (const url of css.match(/url\([^)]*\)/gu) ?? []) assert.match(url, /^url\("?data:/u, url);
  });
});
