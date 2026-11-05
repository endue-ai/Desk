// @vitest-environment jsdom
import type { LocalAgentRun } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { localAgentsStub } from "../bridge/local-agents";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { mountSideBar } from "./SideBar";
import { emptyState, Store } from "./state";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

async function setup() {
  const store = new Store(emptyState("en"));
  const local = localAgentsStub({ epoch: 0, stepMs: 0 });
  store.set({ localAgents: await local.list() });
  const root = document.createElement("div");
  document.body.append(root);
  const ctx = {
    store,
    bridge: { localAgents: local },
    runtime: { shortcuts: { focused: null }, focusSurface: () => undefined },
    tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t("en", key, vars),
  } as unknown as ShellCtx;
  cleanups.push(mountSideBar(root, ctx));
  return { store, root };
}

const running: LocalAgentRun = {
  runId: "run-1",
  agent: "codex",
  caller: "desk",
  prompt: "Rename the loader",
  cwd: "/Users/you/work/harbor",
  access: "read-only",
  state: "running",
  startedAt: "2026-11-05T09:00:00Z",
  text: "",
  tools: 0,
};

describe("the agent bar's local agents", () => {
  it("registers every agent program the core found, above the directory's agents", async () => {
    const { root } = await setup();
    const group = root.querySelector("[data-local-agents]");
    expect(group?.getAttribute("aria-label")).toBe("Agents on this computer");
    const avatars = [...root.querySelectorAll<HTMLButtonElement>("[data-local-agent]")];
    expect(avatars.map((a) => [a.dataset.localAgent, a.textContent, a.title])).toEqual([
      ["claude", "CC", "Claude Code · on this computer"],
      ["codex", "Cx", "Codex · on this computer"],
    ]);
    const labels = [...root.querySelectorAll(".rail-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Local", "Agents", "Spaces"]);
  });

  it("lights an agent while a run of it goes on", async () => {
    const { store, root } = await setup();
    store.set({ localRuns: [running] });
    const codex = root.querySelector<HTMLElement>('[data-local-agent="codex"]');
    expect(codex?.dataset.presence).toBe("working");
    expect(codex?.querySelector(".avatar-dot")).not.toBeNull();
    expect(codex?.title).toBe("Codex · working");
    store.set({ localRuns: [{ ...running, state: "done" }] });
    expect(root.querySelector<HTMLElement>('[data-local-agent="codex"]')?.dataset.presence).toBe(
      "idle",
    );
  });

  it("opens the agent's screen on a click", async () => {
    const { store, root } = await setup();
    root.querySelector<HTMLButtonElement>('[data-local-agent="claude"]')?.click();
    expect(store.get().focused).toBe("local:claude");
    expect(root.querySelector('[data-local-agent="claude"]')?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("shows no group on a desk that found none", async () => {
    const { store, root } = await setup();
    store.set({ localAgents: [] });
    expect(root.querySelector("[data-local-agents]")).toBeNull();
  });
});
