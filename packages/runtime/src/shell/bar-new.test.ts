// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { settle, testDesk } from "../surface/endue/test-desk";
import { watchEndue } from "../system/endue";
import { barWord, moreControl, NEW_AGENT_PAGE, NEW_SPACE_PAGE } from "./bar-new";
import { mountSideBar } from "./SideBar";

type Run = (command: string, args?: unknown) => Promise<unknown>;

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** The agent bar on the test desk, its commands answering as `run` does; what ran, and what the
 *  system browser opened. */
function mounted(run?: Run, lang: "en" | "ko" = "en") {
  const desk = testDesk(lang);
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
  offs.push(mountSideBar(root, desk.ctx), watchEndue(desk.ctx));
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

  it("New agent opens endue.ai's page where the desk has no Agents", async () => {
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
});

describe("the place past six agents", () => {
  const more = (faces: { colour?: string }[]) =>
    moreControl({
      key: "agents-more",
      label: `${faces.length} more agents`,
      caption: barWord("en", "more", faces.length),
      faces,
      expanded: false,
      onClick: () => undefined,
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
  });

  it("says how many in either language", () => {
    expect(barWord("en", "more", 3)).toBe("+3 more");
    expect(barWord("ko", "more", 3)).toBe("+3 더보기");
  });
});
