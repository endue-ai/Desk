// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { localAgentsStub } from "../../bridge/local-agents";
import type { ShellCtx } from "../../shell/context";
import { emptyState, Store } from "../../shell/state";
import { loadLocalAgents, watchLocalAgents } from "../../system/local-agents";
import { localAgentBody } from "./screen";

const EPOCH = Date.parse("2026-11-05T10:00:00Z");
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

async function mount(agent: "claude" | "codex" = "claude") {
  const store = new Store(emptyState("en"));
  const local = localAgentsStub({ epoch: EPOCH, stepMs: 0 });
  const ctx = {
    store,
    bridge: { localAgents: local },
    wall: () => EPOCH,
    platform: "mac",
  } as unknown as ShellCtx;
  await loadLocalAgents(ctx);
  cleanups.push(watchLocalAgents(ctx));
  const view = localAgentBody(ctx, agent);
  document.body.append(view.el);
  cleanups.push(() => view.off?.());
  await settle();
  return { store, local, el: view.el };
}

const titles = (el: HTMLElement) =>
  [...el.querySelectorAll(".local-session-title")].map((t) => t.textContent);
const click = (el: HTMLElement, selector: string) => {
  const target = el.querySelector<HTMLElement>(selector);
  if (!target) throw new Error(`Missing ${selector}`);
  target.click();
};

describe("a local agent's screen", () => {
  it("shows who the agent is and its sessions from its files, the newest first", async () => {
    const { el } = await mount();
    expect(el.querySelector(".agent-name")?.textContent).toBe("Claude Code");
    expect(el.querySelector(".agent-meta")?.textContent).toBe(
      "Anthropic · v2.4.1 · /usr/local/bin/claude",
    );
    expect([...el.querySelectorAll(".local-tabs .segment")].map((t) => t.textContent)).toEqual([
      "Sessions 4",
      "Archive 2",
      "In Desk 0",
    ]);
    expect(titles(el)).toEqual([
      "Fix the flaky upload test",
      "Add dark mode to the settings page",
      "Explain the sync engine",
      "Write the release notes for 1.4",
    ]);
    expect(el.querySelector(".local-session-meta")?.textContent).toBe(
      "work/atlas · main · 12 min ago",
    );
  });

  it("switches to the archive and finds sessions by their words", async () => {
    const { el } = await mount();
    click(el, '[data-tab="archive"]');
    await settle();
    expect(titles(el)).toEqual(["Spike: drag and drop on the board", "Old CI migration"]);
    const search = el.querySelector<HTMLInputElement>(".local-search");
    if (!search) throw new Error("no search");
    search.value = "ci";
    search.dispatchEvent(new Event("input"));
    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(titles(el)).toEqual(["Old CI migration"]);
  });

  it("imports sessions and the archive into the desk, then shows them under In Desk", async () => {
    const { el, local } = await mount();
    const imported = vi.spyOn(local, "import");
    click(el, '[data-import="local"]');
    await settle();
    expect(imported).toHaveBeenCalledWith("claude", "local");
    expect(el.querySelector(".local-notice")?.textContent).toBe(
      "Imported 4 into the desk · 0 already up to date",
    );
    click(el, '[data-import="archive"]');
    await settle();
    expect(imported).toHaveBeenLastCalledWith("claude", "archive");
    expect(el.querySelector('[data-tab="desk"]')?.textContent).toBe("In Desk 6");
    click(el, '[data-tab="desk"]');
    await settle();
    expect(titles(el)).toHaveLength(6);
  });

  it("reads the session picked and continues it with a work request", async () => {
    const { el, local, store } = await mount();
    const ask = vi.spyOn(local, "ask");
    click(el, ".local-session");
    await settle();
    expect(el.querySelector(".local-detail-title")?.textContent).toBe("Fix the flaky upload test");
    expect([...el.querySelectorAll(".local-msg-who")].map((w) => w.textContent)).toEqual([
      "You",
      "Tool · Bash",
      "Claude Code",
    ]);
    const prompt = el.querySelector<HTMLTextAreaElement>(".local-prompt");
    if (!prompt) throw new Error("no prompt");
    prompt.value = "Now fix it";
    prompt.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true }));
    await settle();
    const session = local.fixture.sessions[0];
    expect(ask).toHaveBeenCalledWith({
      agent: "claude",
      prompt: "Now fix it",
      access: "read-only",
      sessionId: session?.id,
    });
    expect(prompt.value).toBe("");
    expect(store.get().localRuns[0]).toMatchObject({ state: "done", sessionId: session?.id });
    expect(el.querySelector(".local-run")?.getAttribute("data-state")).toBe("done");
    click(el, ".local-new");
    expect(el.querySelector(".local-detail-title")).toBeNull();
    expect(el.querySelector(".local-folder")).not.toBeNull();
    prompt.value = "Start over";
    el.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(ask).toHaveBeenLastCalledWith({
      agent: "claude",
      prompt: "Start over",
      access: "read-only",
      cwd: "~",
    });
  });

  it("hands a new session work in a folder, with changes allowed when the person says so", async () => {
    const { el, local } = await mount("codex");
    const ask = vi.spyOn(local, "ask");
    click(el, '[data-access="agent"]');
    const folder = el.querySelector<HTMLInputElement>(".local-folder");
    const prompt = el.querySelector<HTMLTextAreaElement>(".local-prompt");
    if (!folder || !prompt) throw new Error("no composer");
    folder.value = "~/work/lumen";
    prompt.value = "Rename the loader";
    el.querySelector("form")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await settle();
    expect(ask).toHaveBeenCalledWith({
      agent: "codex",
      prompt: "Rename the loader",
      access: "agent",
      cwd: "~/work/lumen",
    });
    expect(el.querySelector(".local-composer-hint")?.textContent).toMatch(/change files/);
  });

  it("reads an agent it found no program for, and asks it nothing", async () => {
    const { el, store } = await mount();
    store.set((s) => ({
      localAgents: s.localAgents.map((a) => (a.id === "claude" ? { ...a, program: undefined } : a)),
    }));
    expect(el.querySelector(".agent-meta")?.textContent).toMatch(/reads its sessions only/);
    expect(el.querySelector<HTMLButtonElement>(".local-send")?.disabled).toBe(true);
    expect(titles(el)).toHaveLength(4);
  });
});
