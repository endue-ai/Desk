// @vitest-environment jsdom
import type { A2ATask, LocalAgentRun } from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { agentId, sampleDirectory } from "../bridge/directory";
import { localAgentsStub } from "../bridge/local-agents";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { mountSideBar } from "./SideBar";
import { emptyState, Store } from "./state";

/** The wall clock of these tests: a minute and five seconds into Codex's run. */
const NOW = Date.parse("2026-11-05T09:01:05Z");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

async function setup() {
  const store = new Store(emptyState("en"));
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const local = localAgentsStub({ epoch: 0, stepMs: 0 });
  store.set({ localAgents: await local.list() });
  const root = document.createElement("div");
  document.body.append(root);
  const ctx = {
    store,
    wm,
    bridge: { localAgents: local },
    runtime: {
      shortcuts: { focused: null },
      focusSurface: () => undefined,
      followSurface: () => undefined,
    },
    tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t("en", key, vars),
    wall: () => NOW,
  } as unknown as ShellCtx;
  cleanups.push(mountSideBar(root, ctx));
  return { store, root };
}

/** The sample directory's Home space in the store: Mira works, Theo idles, Juno is inactive. */
function withDirectory(store: Store) {
  const directory = sampleDirectory(NOW);
  store.set({
    spaces: directory.spaces,
    spaceId: "sp_home",
    agents: directory.agents.map((a) => a.agent),
    spaceAgents: [agentId(1), agentId(2), agentId(3)],
    agentId: agentId(1),
    tasks: directory.tasks,
    directory: "ready",
  });
  return directory;
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

const one = (root: HTMLElement, selector: string) => {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`no ${selector}`);
  return el;
};
const tooltip = (root: HTMLElement) => one(root, '[role="tooltip"]');
const lines = (root: HTMLElement) => [...tooltip(root).children].map((line) => line.textContent);
const over = (el: Element) => el.dispatchEvent(new Event("pointerover", { bubbles: true }));

describe("the agent bar's local agents", () => {
  it("registers every agent program the core found, above the directory's agents", async () => {
    const { root } = await setup();
    const group = root.querySelector("[data-local-agents]");
    expect(group?.getAttribute("aria-label")).toBe("Agents on this computer");
    const avatars = [...root.querySelectorAll<HTMLButtonElement>("[data-local-agent]")];
    expect(
      avatars.map((a) => [a.dataset.localAgent, a.textContent, a.getAttribute("aria-label")]),
    ).toEqual([
      ["claude", "CC", "Claude Code · on this computer"],
      ["codex", "Cx", "Codex · on this computer"],
    ]);
  });

  it("lights an agent while a run of it goes on", async () => {
    const { store, root } = await setup();
    store.set({ localRuns: [running] });
    const codex = root.querySelector<HTMLElement>('[data-local-agent="codex"]');
    expect(codex?.dataset.presence).toBe("working");
    expect(codex?.getAttribute("aria-label")).toBe("Codex · working");
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

describe("the agent bar at rest (#292)", () => {
  it("shows no caption, and rules divide the local programs, the agents and the spaces", async () => {
    const { store, root } = await setup();
    withDirectory(store);
    const bar = one(root, ".sidebar");
    expect(bar.querySelector(".rail-label")).toBeNull();
    const words = (bar.textContent ?? "").split(/[^A-Za-z]+/);
    for (const caption of ["Local", "Agents", "Spaces"]) expect(words).not.toContain(caption);
    expect(
      [...bar.children].map((part) =>
        part.getAttribute("role") === "group"
          ? part.getAttribute("aria-label")
          : part.getAttribute("role"),
      ),
    ).toEqual(["Agents on this computer", "separator", "Agents", "separator", "Spaces"]);
  });

  it("says an agent's state in `data-presence` and draws no dot", async () => {
    const { store, root } = await setup();
    withDirectory(store);
    store.set({ localRuns: [running] });
    const state = (selector: string) => {
      const avatar = one(root, selector);
      return [avatar.dataset.presence, avatar.getAttribute("aria-label")];
    };
    expect(state('[data-local-agent="codex"]')).toEqual(["working", "Codex · working"]);
    expect(state('[data-local-agent="claude"]')).toEqual([
      "idle",
      "Claude Code · on this computer",
    ]);
    expect(state(`[data-agent="${agentId(1)}"]`)).toEqual(["working", "Mira · working"]);
    expect(state(`[data-agent="${agentId(2)}"]`)).toEqual(["idle", "Theo"]);
    expect(state(`[data-agent="${agentId(3)}"]`)).toEqual(["waiting", "Juno · waiting"]);
    expect(root.querySelector(".avatar-dot")).toBeNull();
    expect(root.querySelector(".sidebar .dot")).toBeNull();
  });

  it("an agent a task waits on for an answer waits too, unless it works", async () => {
    const { store, root } = await setup();
    const directory = withDirectory(store);
    const asks = (target: number): A2ATask => ({
      ...(directory.tasks[0] as A2ATask),
      id: `a2a_asks_${target}`,
      targetAgentId: agentId(target),
      status: "input_required",
    });
    store.set({ tasks: [...directory.tasks, asks(1), asks(2)] });
    const theo = one(root, `[data-agent="${agentId(2)}"]`);
    expect(theo.dataset.presence).toBe("waiting");
    expect(theo.getAttribute("aria-label")).toBe("Theo · waiting");
    expect(one(root, `[data-agent="${agentId(1)}"]`).dataset.presence).toBe("working");
  });

  it("marks the selected agent and the selected space, and nothing else", async () => {
    const { store, root } = await setup();
    withDirectory(store);
    const marked = (selector: string) =>
      [...root.querySelectorAll<HTMLElement>(`.sidebar ${selector}`)].map(
        (el) => el.dataset.agent ?? el.dataset.space ?? el.dataset.localAgent,
      );
    expect(marked('[aria-pressed="true"]')).toEqual([agentId(1), "sp_home"]);
    expect(marked(".is-selected")).toEqual([agentId(1), "sp_home"]);
    store.set({ agentId: agentId(2) });
    expect(marked('[aria-pressed="true"]')).toEqual([agentId(2), "sp_home"]);
    expect(marked(".is-selected")).toEqual([agentId(2), "sp_home"]);
  });

  it("names an avatar in the bar's own tooltip on hover and on focus", async () => {
    const { store, root } = await setup();
    withDirectory(store);
    const claude = one(root, '[data-local-agent="claude"]');
    expect(tooltip(root).hidden).toBe(true);
    over(claude);
    expect(tooltip(root).hidden).toBe(false);
    expect(lines(root)).toEqual(["Claude Code · on this computer"]);
    one(root, ".sidebar").dispatchEvent(new Event("pointerleave"));
    expect(tooltip(root).hidden).toBe(true);
    claude.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(lines(root)).toEqual(["Claude Code · on this computer"]);
    expect(tooltip(root).hidden).toBe(false);
    claude.dispatchEvent(new Event("focusout", { bubbles: true }));
    expect(tooltip(root).hidden).toBe(true);
    // Labelled once (ADR 0193): the page's tooltip, and no `title` the compositor would draw too.
    expect(root.querySelectorAll(".sidebar button")).toHaveLength(7);
    expect(root.querySelector(".sidebar button[title]")).toBeNull();
  });

  it("a working agent's tooltip adds its goal and the time since it started", async () => {
    const { store, root } = await setup();
    withDirectory(store);
    store.set({ localRuns: [running] });
    over(one(root, '[data-local-agent="codex"]'));
    expect(lines(root)).toEqual(["Codex · working", "Rename the loader · 1:05"]);
    over(one(root, `[data-agent="${agentId(1)}"]`));
    expect(lines(root)).toEqual(["Mira · working", "Sort the inbox · 4:12"]);
    over(one(root, `[data-agent="${agentId(3)}"]`));
    expect(lines(root)).toEqual(["Juno · waiting"]);
    over(one(root, '[data-space="sp_home"]'));
    expect(lines(root)).toEqual(["Home"]);
    over(one(root, '[data-space="sp_studio"]'));
    expect(lines(root)).toEqual(["Studio", "Client work"]);
    // A run with nothing asked of it says the time alone; the bar's redraw keeps the tooltip.
    over(one(root, '[data-local-agent="codex"]'));
    store.set({ localRuns: [{ ...running, runId: "run-2", prompt: " " }] });
    expect(tooltip(root).hidden).toBe(false);
    expect(lines(root)).toEqual(["Codex · working", "1:05"]);
  });

  it("past six agents the last place opens the rest, named by the tooltip and no title", async () => {
    const { store, root } = await setup();
    const directory = withDirectory(store);
    const [first] = directory.agents;
    if (!first) throw new Error("no sample agent");
    const more = ["Ada", "Bo", "Cy", "Dee"].map((name, n) => ({
      ...first.agent,
      id: `ag_extra_${n}`,
      name,
    }));
    store.set({
      agents: [...store.get().agents, ...more],
      spaceAgents: [...store.get().spaceAgents, ...more.map((a) => a.id)],
    });
    expect(root.querySelectorAll(".sidebar [data-agent]")).toHaveLength(5);
    const rest = one(root, ".avatar-more");
    // Their faces, two of them, and how many under them.
    expect(rest.querySelectorAll(".bar-more-face")).toHaveLength(2);
    expect(rest.textContent).toBe("+2 more");
    expect(rest.getAttribute("aria-label")).toBe("2 more agents");
    expect(rest.hasAttribute("title")).toBe(false);
    over(rest);
    expect(lines(root)).toEqual(["2 more agents"]);
    rest.click();
    expect(rest.isConnected).toBe(false);
    expect(one(root, ".avatar-more").getAttribute("aria-expanded")).toBe("true");
    const list = one(root, ".agents-popover");
    expect([...list.querySelectorAll("[data-agent]")].map((a) => a.textContent)).toEqual([
      "CCy",
      "DDee",
    ]);
    // Open, the list says what the tooltip would.
    expect(tooltip(root).hidden).toBe(true);
  });
});
