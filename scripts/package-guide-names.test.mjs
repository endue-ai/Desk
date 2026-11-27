import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const guide = (folder) => readFileSync(new URL(`${folder}/README.md`, root), "utf8");

const packages = [
  "crates/desk-bridge",
  "crates/desk-computer",
  "crates/desk-mcp-client",
  "crates/desk-mcp",
  "crates/desk-platform",
  "crates/desk-update",
  "packages/bridge",
  "packages/ui",
  "plugins/eris",
  "plugins/item",
  "plugins/notify",
  "plugins/palette",
  "plugins/profiles",
  "plugins/session",
  "plugins/slides",
  "plugins/theme",
];

test("package guides identify the endue app in reader-facing text", () => {
  for (const folder of packages) {
    const prose = guide(folder).replace(/`[^`\n]*`/gu, "");
    assert.ok(!/\bDesk\b/u.test(prose), `${folder} uses the earlier product name`);
    assert.match(prose, /\bendue\b/u, folder);
  }
});

test("the item and palette guides use the labels in the endue interface", () => {
  const item = guide("plugins/item");
  assert.ok(item.includes("Open in endue"), "the item guide must name the action");
  assert.ok(
    item.includes("This item is not in endue any more."),
    "the item guide must name the empty state",
  );
  const palette = guide("plugins/palette");
  assert.match(palette, /\*\*In endue:\*\* `Mod\+K`/u);
});
