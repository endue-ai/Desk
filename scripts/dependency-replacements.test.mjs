import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const lockfile = readFileSync(new URL("../Cargo.lock", import.meta.url), "utf8");
const packages = [...lockfile.matchAll(/^\[\[package\]\]\nname = "([^"]+)"/gmu)].map(
  ([, name]) => name,
);

test("the release dependency graph uses maintained clocks and font parsers and the approved CEF decoder", () => {
  for (const removed of ["chrono", "ttf-parser", "libbz2-rs-sys"]) {
    assert.ok(!packages.includes(removed), `release graph still resolves ${removed}`);
  }
  for (const replacement of ["jiff", "web-time", "read-fonts", "crabz2"]) {
    assert.ok(packages.includes(replacement), `release graph must resolve ${replacement}`);
  }
});

test("the CEF downloader is the sole user of the decoder adapter", () => {
  const users = lockfile
    .split("[[package]]")
    .filter((entry) => /^ "bzip2(?: [^"]+)?",$/mu.test(entry));
  assert.deepEqual(
    users.map((entry) => /^name = "([^"]+)"/mu.exec(entry)?.[1]),
    ["download-cef"],
  );
});
