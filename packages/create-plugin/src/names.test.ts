import { describe, expect, it } from "vitest";
import { checkId, defaultId, defaultName } from "./names";

describe("defaultId", () => {
  // The same rule as desk-core `fallback_id`, so a scaffolded folder keeps the id Desk would give it.
  it.each([
    ["my-plugin", "local.my-plugin"],
    ["My Plugin", "local.my-plugin"],
    ["hello_ui", "local.hello-ui"],
    ["--notes--", "local.notes"],
    ["2fa", "local.p2fa"],
    ["---", "local.plugin"],
    ["", "local.plugin"],
    ["메모 앱", "local.plugin"],
    ["ab😀cd", "local.ab-cd"],
  ])("%j becomes %s", (folder, id) => {
    expect(defaultId(folder)).toBe(id);
    expect(checkId(id)).toBeNull();
  });
});

describe("defaultName", () => {
  it.each([
    ["my-plugin", "My plugin"],
    ["hello_ui", "Hello ui"],
    ["notes", "Notes"],
    ["---", "Plugin"],
  ])("%j becomes %s", (folder, name) => {
    expect(defaultName(folder)).toBe(name);
  });
});

describe("checkId", () => {
  it.each(["example.my-plugin", "endue.eris", "a.b.c"])("accepts %s", (id) => {
    expect(checkId(id)).toBeNull();
  });

  it.each([
    "my-plugin",
    "Example.plugin",
    "example.2fa",
    "example..plugin",
    "example.my_plugin",
    `example.${"a".repeat(128)}`,
  ])("refuses %s", (id) => {
    expect(checkId(id)).toMatch(/^id /);
  });
});
