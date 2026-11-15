// @vitest-environment jsdom
// The agent bar's unfolded list (issue 294, design 291): a caption per group, a row per agent
// (its face with the ring's state, its name, what it does or its state, the time it has worked)
// and a row per space, the selected one checked. A row is the avatar's own control in another
// form: the same key, data and name, and pressing it does the same. jsdom lays nothing out.
import type { A2ATask, LocalAgentRun } from "@endue-ai/bridge";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentId, sampleDirectory } from "../bridge/directory";
import { localAgentsStub } from "../bridge/local-agents";
import { ManualClock } from "../clock";
import { testWindowManager } from "../wm/testing";
import { takeDesk } from "../wm/view";
import type { ShellCtx } from "./context";
import { t } from "./copy";
import { mountSideBar } from "./SideBar";
import { emptyState, Store } from "./state";
import { Ticker } from "./ticker";

/** The wall clock these tests start at: a minute and five seconds into Codex's run. */
const NOW = Date.parse("2026-11-05T09:01:05Z");

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

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const off of cleanups.splice(0)) off();
  document.body.replaceChildren();
});

/** The bar over the sample directory's Home space: Mira works, Theo idles, Juno is inactive. */
async function setup() {
  const directory = sampleDirectory(NOW);
  const local = localAgentsStub({ epoch: 0, stepMs: 0 });
  const store = new Store({
    ...emptyState("en"),
    localAgents: await local.list(),
    spaces: directory.spaces,
    spaceId: "sp_home",
    agents: directory.agents.map((a) => a.agent),
    spaceAgents: [agentId(1), agentId(2), agentId(3)],
    agentId: agentId(1),
    tasks: directory.tasks,
    directory: "ready",
  });
  const wm = testWindowManager();
  wm.connect((published) => takeDesk(store, published));
  const clock = new ManualClock();
  const ticker = new Ticker(clock);
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
    ticker,
    tr: (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
      t("en", key, vars),
    wall: () => NOW + clock.now(),
  } as unknown as ShellCtx;
  cleanups.push(mountSideBar(root, ctx), () => ticker.dispose());
  const bar = root.querySelector<HTMLElement>(".sidebar");
  if (!bar) throw new Error("no agent bar");
  const one = (selector: string) => {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`no ${selector}`);
    return el;
  };
  /** Unfold or fold the bar from its control, with no clock. */
  const toggle = () => one('[data-key="agents-unfold"]').click();
  /** What a row says: its name, its note and its time; null where it has none. */
  const says = (selector: string) =>
    [".bar-row-name", ".bar-row-note", ".bar-row-time"].map(
      (part) => one(`.bar-row${selector}`).querySelector(part)?.textContent ?? null,
    );
  return { store, clock, directory, root, bar, one, toggle, says };
}

/** The bar's controls in its groups, in order: each one's key and name. */
const controls = (bar: HTMLElement) =>
  [...bar.querySelectorAll<HTMLElement>(".bar-group button")].map((c) => [
    c.dataset.key,
    c.getAttribute("aria-label"),
  ]);

/** Four more agents in the Home space: seven in all, one more than the bar shows. */
function crowd(store: Store) {
  const [first] = store.get().agents;
  if (!first) throw new Error("no sample agent");
  const more = ["Ada", "Bo", "Cy", "Dee"].map((name, n) => ({
    ...first,
    id: `ag_extra_${n}`,
    name,
  }));
  store.set({
    agents: [...store.get().agents, ...more],
    spaceAgents: [...store.get().spaceAgents, ...more.map((a) => a.id)],
  });
}

describe("the agent bar's unfolded list (issue 294)", () => {
  it("unfolded, each group has its caption and each agent and space its row", async () => {
    const { bar, toggle } = await setup();
    // Folded, the bar holds no row and no caption.
    expect(bar.querySelector(".bar-row")).toBeNull();
    expect(bar.querySelector(".bar-caption")).toBeNull();

    toggle();
    const groups = [...bar.querySelectorAll<HTMLElement>(".bar-group")];
    expect(
      groups.map((group) => [
        group.getAttribute("role"),
        group.getAttribute("aria-label"),
        [...group.querySelectorAll(".bar-caption")].map((c) => c.textContent),
        group.querySelectorAll("button.bar-row.menu-item").length,
        group.querySelectorAll("button").length,
      ]),
    ).toEqual([
      ["group", "Agents on this computer", ["This computer"], 2, 2],
      ["group", "Agents", ["Agents"], 3, 3],
      ["group", "Spaces", ["Spaces"], 2, 2],
    ]);
    // The group has the name already: its caption is for the eye.
    for (const caption of bar.querySelectorAll(".bar-caption"))
      expect(caption.getAttribute("aria-hidden")).toBe("true");
    expect(bar.querySelector(".icon-button.avatar, .icon-button.space")).toBeNull();

    toggle();
    expect(bar.querySelector(".bar-row")).toBeNull();
    expect(bar.querySelector(".bar-caption")).toBeNull();
  });

  it("a row says the name, the goal or the state, and a working agent's time", async () => {
    const { store, directory, one, toggle, says } = await setup();
    store.set({ localRuns: [running] });
    toggle();
    expect(says('[data-local-agent="codex"]')).toEqual(["Codex", "Rename the loader", "1:05"]);
    expect(says('[data-local-agent="claude"]')).toEqual(["Claude Code", "Idle", null]);
    // Mira's task started 4:12 before; Theo has nothing to do; Juno is inactive.
    expect(says(`[data-agent="${agentId(1)}"]`)).toEqual(["Mira", "Sort the inbox", "4:12"]);
    expect(says(`[data-agent="${agentId(2)}"]`)).toEqual(["Theo", "Idle", null]);
    expect(says(`[data-agent="${agentId(3)}"]`)).toEqual(["Juno", "Waiting", null]);
    expect(says('[data-space="sp_home"]')).toEqual(["Home", null, null]);
    expect(says('[data-space="sp_studio"]')).toEqual(["Studio", null, null]);

    // Each row's face carries the avatar's state, which the ring is drawn from.
    const face = (selector: string) => {
      const row = one(`.bar-row${selector}`);
      return [row.dataset.presence, row.querySelector<HTMLElement>(".bar-face")?.dataset.presence];
    };
    expect(face('[data-local-agent="codex"]')).toEqual(["working", "working"]);
    expect(face('[data-local-agent="claude"]')).toEqual(["idle", "idle"]);
    expect(face(`[data-agent="${agentId(1)}"]`)).toEqual(["working", "working"]);
    expect(face(`[data-agent="${agentId(2)}"]`)).toEqual(["idle", "idle"]);
    expect(face(`[data-agent="${agentId(3)}"]`)).toEqual(["waiting", "waiting"]);
    expect(one('.bar-row[data-agent] [aria-hidden="true"].bar-face').textContent).toBe("M");

    // An agent a task waits on for an answer waits; one that works with no goal just works.
    const task = (id: string, status: A2ATask["status"], goal?: string): A2ATask => {
      const { goal: _, ...rest } = directory.tasks[0] as A2ATask;
      return { ...rest, id, targetAgentId: agentId(2), status, ...(goal ? { goal } : {}) };
    };
    store.set({ tasks: [...directory.tasks, task("a2a_asks", "input_required", "Which one?")] });
    expect(says(`[data-agent="${agentId(2)}"]`)).toEqual(["Theo", "Waiting", null]);
    store.set({ tasks: [...directory.tasks, task("a2a_plain", "working")] });
    expect(says(`[data-agent="${agentId(2)}"]`)).toEqual(["Theo", "Working", "4:12"]);
    // A run with nothing asked of it: the same word.
    store.set({ localRuns: [{ ...running, prompt: " " }] });
    expect(says('[data-local-agent="codex"]')).toEqual(["Codex", "Working", "1:05"]);
  });

  it("a working agent's time goes on while the list is open", async () => {
    const { store, clock, toggle, says } = await setup();
    store.set({ localRuns: [running] });
    toggle();
    expect(says('[data-local-agent="codex"]')).toEqual(["Codex", "Rename the loader", "1:05"]);
    clock.advance(1000);
    expect(says('[data-local-agent="codex"]')).toEqual(["Codex", "Rename the loader", "1:06"]);
    expect(says(`[data-agent="${agentId(1)}"]`)).toEqual(["Mira", "Sort the inbox", "4:13"]);
    clock.advance(59_000);
    expect(says('[data-local-agent="codex"]')).toEqual(["Codex", "Rename the loader", "2:05"]);

    // With no agent at work the ticker asks for no frame (ADR 0164), the list still open.
    store.set({ localRuns: [], tasks: [] });
    clock.advance(16);
    clock.advance(16);
    const asked = vi.spyOn(clock, "requestFrame");
    clock.advance(16);
    clock.advance(1000);
    expect(asked).not.toHaveBeenCalled();
    // An agent at work again: the frames come back, and with them the time.
    store.set({ localRuns: [running] });
    expect(asked).toHaveBeenCalled();
    const [, , time] = says('[data-local-agent="codex"]');
    clock.advance(1000);
    expect(says('[data-local-agent="codex"]')[2]).not.toBe(time);
  });

  it("the selected space has the check", async () => {
    const { store, bar, toggle } = await setup();
    toggle();
    const id = (row: HTMLElement) =>
      row.dataset.agent ?? row.dataset.space ?? row.dataset.localAgent;
    const marked = (selector: string) =>
      [...bar.querySelectorAll<HTMLElement>(`.bar-row${selector}`)].map(id);
    const checked = () =>
      [...bar.querySelectorAll<HTMLElement>(".bar-row")]
        .filter((row) => row.querySelector('svg[data-icon="check"]'))
        .map(id);
    expect(checked()).toEqual(["sp_home"]);
    expect(marked('[aria-pressed="true"]')).toEqual([agentId(1), "sp_home"]);
    expect(marked(".is-selected")).toEqual([agentId(1), "sp_home"]);
    store.set({ agentId: agentId(3), spaceId: "sp_studio" });
    expect(checked()).toEqual(["sp_studio"]);
    expect(marked('[aria-pressed="true"]')).toEqual([agentId(3), "sp_studio"]);
    expect(marked(".is-selected")).toEqual([agentId(3), "sp_studio"]);
    expect(bar.querySelectorAll(".bar-row .is-selected")).toHaveLength(0);
  });

  it("pressing a row does what pressing its avatar does", async () => {
    const { store, one, toggle } = await setup();
    toggle();
    one(`.bar-row[data-agent="${agentId(2)}"]`).click();
    expect(store.get().agentId).toBe(agentId(2));
    expect(one(`.bar-row[data-agent="${agentId(2)}"]`).getAttribute("aria-pressed")).toBe("true");
    one('.bar-row[data-local-agent="claude"]').click();
    expect(store.get().focused).toBe("local:claude");
    expect(one('.bar-row[data-local-agent="claude"]').getAttribute("aria-pressed")).toBe("true");
    one('.bar-row[data-space="sp_studio"]').click();
    expect(store.get().spaceId).toBe("sp_studio");
  });

  it("names, keys and order are the same folded and unfolded, and no tooltip names a row", async () => {
    const { store, root, bar, one, toggle } = await setup();
    crowd(store);
    const folded = controls(bar);
    expect(folded).toHaveLength(2 + 6 + 2);
    expect(folded.at(7)).toEqual(["agents-more", "2 more agents"]);
    toggle();
    expect(controls(bar)).toEqual(folded);
    // In the tab order the unfold control and the pin come first, then the same controls.
    expect([...bar.querySelectorAll("button")].map((b) => b.getAttribute("data-key"))).toEqual([
      "agents-unfold",
      "agents-pin",
      ...folded.map(([key]) => key),
    ]);
    expect(bar.querySelector("button[title], [tabindex]")).toBeNull();

    // A row says what the tooltip would: none shows for it.
    const tooltip = one('[role="tooltip"]');
    for (const row of bar.querySelectorAll(".bar-row")) {
      row.dispatchEvent(new Event("pointerover", { bubbles: true }));
      expect(tooltip.hidden).toBe(true);
      row.dispatchEvent(new Event("focusin", { bubbles: true }));
      expect(tooltip.hidden).toBe(true);
    }

    // Past six agents the last row is the "more" control, which opens the same popover.
    const rows = [...bar.querySelectorAll<HTMLElement>("[data-agent], [data-key='agents-more']")];
    expect(rows.at(-1)?.dataset.key).toBe("agents-more");
    const more = one('.bar-row[data-key="agents-more"]');
    expect(more.querySelector(".bar-row-name")?.textContent).toBe("2 more agents");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    more.click();
    expect(one('.bar-row[data-key="agents-more"]').getAttribute("aria-expanded")).toBe("true");
    const list = one(".agents-popover");
    expect(list.getAttribute("aria-label")).toBe("2 more agents");
    expect([...list.querySelectorAll("[data-agent]")].map((a) => a.textContent)).toEqual([
      "CCy",
      "DDee",
    ]);
    expect(root.querySelectorAll(".agents-popover")).toHaveLength(1);
  });
});
