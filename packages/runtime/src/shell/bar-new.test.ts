// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../clock";
import { endueText } from "../surface/endue/copy";
import { settle, testDesk } from "../surface/endue/test-desk";
import { watchEndue } from "../system/endue";
import type { BarEntry } from "./bar-list";
import { barMore, barWord, NEW_AGENT_PAGE, NEW_SPACE_PAGE } from "./bar-new";
import { t } from "./copy";
import { mountSideBar } from "./SideBar";
import type { DeskState } from "./state";
import { Ticker } from "./ticker";

type Run = (command: string, args?: unknown) => Promise<unknown>;

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** The agent bar on the test desk, its commands answering as `run` does, from `seed`; what ran,
 *  and what the system browser opened. */
function mounted(run?: Run, lang: "en" | "ko" = "en", seed: Partial<DeskState> = {}) {
  const desk = testDesk(lang);
  desk.store.set(seed);
  const ticker = new Ticker(new ManualClock());
  desk.ctx.ticker = ticker;
  const ran: Array<[string, unknown]> = [];
  if (run) {
    const commands = {
      run: (command: string, args?: unknown) => {
        ran.push([command, args]);
        return run(command, args);
      },
    };
    Object.assign(desk.ctx.runtime, { commands });
  }
  const root = document.createElement("div");
  document.body.append(root);
  offs.push(mountSideBar(root, desk.ctx), watchEndue(desk.ctx), () => ticker.dispose());
  return { ...desk, root, ran, opened: () => desk.bridge.fake.opened };
}

const control = (root: HTMLElement, key: string) => {
  const el = root.querySelector<HTMLButtonElement>(`[data-key="${key}"]`);
  if (!el) throw new Error(`no ${key}`);
  return el;
};
/** The bar group `el` is in, and that group's last control. */
const groupOf = (el: HTMLElement) => {
  const group = el.closest<HTMLElement>(".bar-group");
  const controls = [...(group?.querySelectorAll(":scope > button") ?? [])];
  return { name: group?.getAttribute("aria-label"), last: controls.at(-1) };
};

describe("the agent bar's New agent and New space", () => {
  it("ends the agents' group with New agent and the spaces' with New space, each named", () => {
    const { root } = mounted();
    const agent = control(root, "agents-new");
    expect(groupOf(agent)).toEqual({ name: "Agents", last: agent });
    expect(agent.getAttribute("aria-label")).toBe("Create a new agent");
    expect(agent.textContent).toBe("New agent");
    expect(agent.classList.contains("add-button")).toBe(true);
    const space = control(root, "spaces-new");
    expect(groupOf(space)).toEqual({ name: "Spaces", last: space });
    expect(space.getAttribute("aria-label")).toBe("Create a new space");
    expect(space.textContent).toBe("New space");
  });

  it("keeps them signed in to endue, after the person's agents and spaces", async () => {
    const { root, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    const agent = control(root, "agents-new");
    expect(groupOf(agent).last).toBe(agent);
    expect(agent.closest(".bar-group")?.querySelector("[data-endue-agent]")).not.toBeNull();
    const space = control(root, "spaces-new");
    expect(groupOf(space).last).toBe(space);
    expect(space.closest(".bar-group")?.querySelector("[data-endue-space]")).not.toBeNull();
  });

  it("says them in Korean on a Korean desk", () => {
    const { root } = mounted(undefined, "ko");
    expect(control(root, "agents-new").textContent).toBe("새 에이전트");
    expect(control(root, "spaces-new").getAttribute("aria-label")).toBe("새 스페이스 만들기");
  });

  it("New agent opens the Agents plugin, then its New agent page", async () => {
    const { root, ran, opened, store } = mounted(async () => undefined);
    store.set({ popover: "agents-more" });
    control(root, "agents-new").click();
    await settle();
    expect(ran).toEqual([
      ["desk.plugins.open", { plugin: "endue.agents" }],
      ["endue.agents.new", undefined],
    ]);
    expect(opened()).toEqual([]);
    expect(store.get().popover).toBeNull();
  });

  it("asks the Agents plugin again while it is still starting", async () => {
    vi.useFakeTimers();
    let asked = 0;
    const { root, ran } = mounted(async (command) => {
      if (command === "endue.agents.new" && ++asked < 3) throw new Error("not registered yet");
    });
    control(root, "agents-new").click();
    await vi.advanceTimersByTimeAsync(300);
    expect(ran.filter(([command]) => command === "endue.agents.new")).toHaveLength(3);
  });

  it("New agent opens endue.ai's page in a desk window where the desk has no Agents", async () => {
    const { root, ran, opened } = mounted(async (command, args) => {
      if (command === "desk.plugins.open" && (args as { plugin: string }).plugin === "endue.agents")
        throw new Error("no plugin endue.agents");
    });
    control(root, "agents-new").click();
    await settle();
    await settle();
    expect(ran).toEqual([
      ["desk.plugins.open", { plugin: "endue.agents" }],
      ["desk.plugins.open", { plugin: "endue.browser" }],
      ["endue.browser.go", { url: NEW_AGENT_PAGE }],
    ]);
    expect(opened()).toEqual([]);
  });

  it("New agent opens endue.ai's page in the system browser where the desk has no windows for it", async () => {
    const { root, opened } = mounted(async (command) => {
      if (command === "desk.plugins.open") throw new Error("no plugin");
    });
    control(root, "agents-new").click();
    await settle();
    await settle();
    expect(opened()).toEqual([NEW_AGENT_PAGE]);
  });

  it("New space shows endue.ai's page for it in a desk window", async () => {
    const { root, ran } = mounted(async () => undefined);
    control(root, "spaces-new").click();
    await settle();
    expect(ran).toEqual([
      ["desk.plugins.open", { plugin: "endue.browser" }],
      ["endue.browser.go", { url: NEW_SPACE_PAGE }],
    ]);
    expect(NEW_SPACE_PAGE).toBe("https://endue.ai/spaces/new");
  });

  it("unfolded, they are rows of the list, each named beside its dashed face", () => {
    const { root, ran } = mounted(async () => undefined, "en", { agentsPinned: true });
    expect(root.querySelector(".sidebar.is-unfolded")).not.toBeNull();
    const agent = control(root, "agents-new");
    expect(agent.classList.contains("bar-row")).toBe(true);
    expect(agent.classList.contains("menu-item")).toBe(true);
    expect(agent.querySelector(".bar-row-name")?.textContent).toBe("New agent");
    expect(agent.querySelector(".bar-new-face")).not.toBeNull();
    expect(groupOf(agent)).toEqual({ name: "Agents", last: agent });
    const space = control(root, "spaces-new");
    expect(space.classList.contains("bar-row-space")).toBe(true);
    expect(groupOf(space)).toEqual({ name: "Spaces", last: space });
    // The same press in either form.
    space.click();
    expect(ran[0]).toEqual(["desk.plugins.open", { plugin: "endue.browser" }]);
  });
});

describe("the place past six agents", () => {
  /** The list's entry for the rest of `n` agents (SideBar.ts), and what pressing it did. */
  const rest = (n: number) => {
    const pressed: number[] = [];
    const entry: BarEntry = {
      face: "avatar avatar-more",
      glyph: `+${n}`,
      attrs: {
        "data-key": "agents-more",
        "aria-label": `${n} more agents`,
        "aria-expanded": "false",
      },
      name: `${n} more agents`,
      tip: () => [`${n} more agents`],
      onClick: () => pressed.push(n),
    };
    return { entry, pressed };
  };
  const more = (faces: { colour?: string }[], unfolded = false) =>
    barMore(rest(faces.length).entry, {
      caption: barWord("en", "more", faces.length),
      faces,
      unfolded,
      now: 0,
    });

  it("shows up to four of the rest's faces, each in its own colour when it has one", () => {
    const six = more([{ colour: "#B6A3F5" }, {}, {}, {}, {}, {}]);
    const faces = six.querySelectorAll<HTMLElement>(".bar-more-face");
    expect(faces).toHaveLength(4);
    expect(faces[0]?.style.getPropertyValue("--face-colour")).toBe("#B6A3F5");
    expect(faces[1]?.style.getPropertyValue("--face-colour")).toBe("");
    expect(six.querySelector(".bar-more-faces")?.getAttribute("data-count")).toBe("4");
    expect(six.textContent).toBe("+6 more");
    expect(six.getAttribute("aria-label")).toBe("6 more agents");
    expect(six.getAttribute("aria-expanded")).toBe("false");
  });

  it("unfolded, is the list's own row for the rest, with the same key and press", () => {
    const { entry, pressed } = rest(3);
    const row = barMore(entry, { caption: "+3 more", faces: [{}, {}, {}], unfolded: true, now: 0 });
    expect(row.classList.contains("bar-row")).toBe(true);
    expect(row.dataset.key).toBe("agents-more");
    expect(row.querySelector(".bar-more-faces")).toBeNull();
    expect(row.querySelector(".bar-row-name")?.textContent).toBe("3 more agents");
    row.click();
    expect(pressed).toEqual([3]);
  });

  it("says how many in either language, inside the name of the rest (WCAG 2.5.3)", () => {
    for (const lang of ["ko", "en"] as const) {
      const shown = (key: "more" | "moreEndue") => barWord(lang, key, 3).replace(/^\+/, "");
      expect(t(lang, "moreAgents", { n: 3 })).toContain(shown("more"));
      expect(endueText(lang, "moreAgents", { n: 3 })).toContain(shown("moreEndue"));
    }
    expect(barWord("en", "more", 3)).toBe("+3 more");
    expect(barWord("ko", "more", 3)).toBe("+3명 더");
    expect(barWord("ko", "moreEndue", 3)).toBe("+3개 더");
    expect(barWord("en", "moreEndue", 3)).toBe("+3 more");
  });
});
