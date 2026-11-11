// @vitest-environment jsdom
// The Plugins list's rows (ui/rows.js): a checkbox per plugin, the list's own row locked on, a failed
// plugin's reason, and why a plugin is off for this start only (plugin.list's heldOff: init.yaml, safe
// mode, a quarantine), with the box still ticked to turn it on. The status line says how to get the
// list back once its window is closed (Mod+Shift+X, the desk's own key).
import { describe, expect, it } from "vitest";
import { HOLDS, row, status } from "../ui/rows.js";

type Info = {
  id: string;
  status: "ready" | "failed";
  enabled: boolean;
  builtIn: boolean;
  revision: number;
  manifest?: { name?: string };
  error?: string;
  heldOff?: "init" | "safe-mode" | "quarantine";
};

const plugin = (id: string, extra: Partial<Info> = {}): Info => ({
  id,
  status: "ready",
  enabled: true,
  builtIn: true,
  revision: 1,
  manifest: { name: id.split(".")[1] },
  ...extra,
});

/** The row's checkbox, in the document (a detached box fires no change). */
const box = (item: HTMLElement) => {
  if (!item.isConnected) document.body.append(item);
  return item.querySelector("input") as HTMLInputElement;
};

describe("a row of the Plugins list", () => {
  it("ticks a plugin that is on and calls back with the new state", () => {
    const toggled: Array<[string, boolean]> = [];
    const item = row(document, plugin("endue.notes"), {
      self: "endue.sidebar",
      toggle: (id, on) => toggled.push([id, on]),
    });
    expect(item.textContent).toContain("notes");
    expect(box(item).checked).toBe(true);
    box(item).click();
    expect(toggled).toEqual([["endue.notes", false]]);
  });

  it("locks the list's own row on, and a failed plugin's row with its reason", () => {
    const own = row(document, plugin("endue.sidebar"), { self: "endue.sidebar", toggle: () => {} });
    expect(box(own).disabled).toBe(true);
    const failed = plugin("example.broken", {
      status: "failed",
      enabled: false,
      error: "no entry",
    });
    const item = row(document, failed, { self: "endue.sidebar", toggle: () => {} });
    expect(box(item).disabled).toBe(true);
    expect(item.textContent).toContain("no entry");
  });

  it("says why a plugin is off for this start, and its box still turns it on", () => {
    for (const hold of ["init", "safe-mode", "quarantine"] as const) {
      const toggled: Array<[string, boolean]> = [];
      const held = plugin("endue.onboarding", { enabled: false, heldOff: hold });
      const item = row(document, held, {
        self: "endue.sidebar",
        toggle: (id, on) => toggled.push([id, on]),
      });
      expect(item.querySelector("small")?.textContent).toBe(HOLDS[hold]);
      expect(box(item).disabled).toBe(false);
      box(item).click();
      expect(toggled).toEqual([["endue.onboarding", true]]);
    }
    expect(HOLDS.init).toContain("init.yaml");
  });
});

describe("the status line", () => {
  it("counts the plugins and names the key that brings the list back", () => {
    expect(status(58, "mac")).toBe("58 installed · ⇧⌘X opens this list");
    expect(status(1, "other")).toBe("1 installed · Ctrl+Shift+X opens this list");
  });
});
