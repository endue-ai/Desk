// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { byRole, type RoleSettings } from "./roles";

// The shell's parts hold their roles until desk.roles names another provider (ADR 0104).
function settings(initial: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = { ...initial };
  const listeners = new Set<(keys: string[]) => void>();
  const store: RoleSettings & { set(key: string, value: unknown): void } = {
    get: <T>(key: string, fallback?: T) => (values[key] ?? fallback) as T,
    onChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (key, value) => {
      values[key] = value;
      for (const listener of listeners) listener([key]);
    },
  };
  return store;
}

describe("the shell's parts by role", () => {
  it("shows a part while its role is the shell's, hides it while another provider is named, and stops on off", () => {
    const root = document.createElement("div");
    root.append(document.createElement("main"));
    const s = settings();
    let stopped = false;
    const off = byRole(root, "role:rail", s, (at) => {
      at.append(Object.assign(document.createElement("aside"), { className: "rail" }));
      return () => {
        stopped = true;
      };
    });
    const rail = root.querySelector<HTMLElement>(".rail");
    expect(rail?.hidden).toBe(false);
    expect(root.querySelector("main")?.hidden).toBe(false);

    s.set("desk.roles", { "role:rail": "test.rail" });
    expect(rail?.hidden).toBe(true);
    expect(rail?.hasAttribute("data-role-yielded")).toBe(true);
    // Another role's provider leaves the rail alone.
    s.set("desk.roles", { "role:dock": "endue.dock" });
    expect(rail?.hidden).toBe(false);
    s.set("desk.roles", { "role:rail": "desk.shell" });
    expect(rail?.hidden).toBe(false);

    off();
    expect(stopped).toBe(true);
    s.set("desk.roles", { "role:rail": "test.rail" });
    expect(rail?.hidden).toBe(false);
  });

  it("starts hidden when the setting already names another provider", () => {
    const root = document.createElement("div");
    const s = settings({ "desk.roles": { "role:agents": "test.agents" } });
    byRole(root, "role:agents", s, (at) => {
      at.append(Object.assign(document.createElement("aside"), { className: "sidebar" }));
      return () => {};
    });
    expect(root.querySelector<HTMLElement>(".sidebar")?.hidden).toBe(true);
  });
});
