import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { checkMarket, MARKET } from "./theme-market.mjs";

/** A market theme's bundle: a palette in both schemes and nothing else. */
function bundle(id, { license = "CC0-1.0", colors = {} } = {}) {
  const theme = {
    author: "Team endue",
    ...(license ? { license } : {}),
    light: { colors: { background: "#f7f3ea", primary: "#8a4b2a", ...colors } },
    dark: { colors: { background: "#15130f", primary: "#d9a27a", ...colors } },
  };
  const manifest = { id, name: "Dusk", version: "1.0.0", kind: "theme", theme };
  return `${JSON.stringify({ format: "desk-theme/1", manifest, files: {} }, null, 2)}\n`;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function entry(id, text, change = {}) {
  return {
    id,
    name: "Dusk",
    version: "1.0.0",
    author: "Team endue",
    license: "CC0-1.0",
    preview: ["#f7f3ea", "#8a4b2a"],
    url: `${id.slice("market.".length)}.desk-theme`,
    sha256: sha256(text),
    size: Buffer.byteLength(text),
    ...change,
  };
}

/** A market folder: `bundles` by file name and the index listing `entries`. */
function market(bundles, entries) {
  const dir = mkdtempSync(join(tmpdir(), "theme-market-"));
  for (const [name, text] of Object.entries(bundles)) writeFileSync(join(dir, name), text);
  const index = { format: "desk-theme-index/1", themes: entries };
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return dir;
}

const has = (problems, pattern) =>
  assert.ok(
    problems.some((p) => pattern.test(p)),
    `expected a problem matching ${pattern}, got ${JSON.stringify(problems)}`,
  );

describe("theme-market", () => {
  it("passes this repository's market, which has at least two themes", () => {
    assert.deepEqual(checkMarket(MARKET), []);
  });

  it("passes a market whose index matches its bundles", () => {
    const text = bundle("market.dusk");
    assert.deepEqual(
      checkMarket(market({ "dusk.desk-theme": text }, [entry("market.dusk", text)])),
      [],
    );
  });

  it("refuses a wrong hash and a wrong size", () => {
    const text = bundle("market.dusk");
    const wrong = entry("market.dusk", text, { sha256: sha256("another file"), size: 12 });
    const problems = checkMarket(market({ "dusk.desk-theme": text }, [wrong]));
    has(problems, /market\.dusk: sha256 /);
    has(problems, /market\.dusk: size /);
  });

  it("refuses a theme without a licence", () => {
    const text = bundle("market.dusk", { license: "" });
    const { license: _gone, ...unlicensed } = entry("market.dusk", text);
    const problems = checkMarket(market({ "dusk.desk-theme": text }, [unlicensed]));
    has(problems, /index\.json: .*license/);
    has(problems, /market\.dusk: .*licen[cs]e/);
  });

  it("refuses a duplicate id", () => {
    const text = bundle("market.dusk");
    const twice = [entry("market.dusk", text), entry("market.dusk", text)];
    has(checkMarket(market({ "dusk.desk-theme": text }, twice)), /market\.dusk: listed twice/);
  });

  it("refuses an invalid bundle", () => {
    const text = bundle("market.dusk", { colors: { card: "url(x.png)" } });
    const problems = checkMarket(market({ "dusk.desk-theme": text }, [entry("market.dusk", text)]));
    has(problems, /market\.dusk: .*plugin\.json/);
  });

  it("refuses a bundle whose manifest is not the theme the index lists", () => {
    const text = bundle("market.other");
    const problems = checkMarket(market({ "dusk.desk-theme": text }, [entry("market.dusk", text)]));
    has(problems, /market\.dusk: the bundle's id is market\.other/);
  });

  it("refuses a missing bundle and a bundle the index does not list", () => {
    const text = bundle("market.dusk");
    const problems = checkMarket(
      market({ "stray.desk-theme": text }, [entry("market.dusk", text)]),
    );
    has(problems, /market\.dusk: .*dusk\.desk-theme/);
    has(problems, /stray\.desk-theme: not in index\.json/);
  });
});
