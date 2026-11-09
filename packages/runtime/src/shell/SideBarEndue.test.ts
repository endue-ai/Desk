// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { sampleAgentId } from "../bridge/studio-fixtures";
import { settle, testDesk } from "../surface/endue/test-desk";
import { loadEndue, watchEndue } from "../system/endue";
import { mountSideBar } from "./SideBar";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
});

function mounted() {
  const desk = testDesk();
  const root = document.createElement("div");
  document.body.append(root);
  offs.push(mountSideBar(root, desk.ctx), watchEndue(desk.ctx));
  return { ...desk, root };
}

const ids = (root: HTMLElement, attribute: string) =>
  [...root.querySelectorAll<HTMLElement>(`[${attribute}]`)].map((el) => el.getAttribute(attribute));

describe("the agent bar once signed in to endue (ADR 0129)", () => {
  it("keeps the agent directory while signed out", async () => {
    const { root, ctx } = mounted();
    await loadEndue(ctx);
    expect(root.querySelector("[data-endue-agents]")).toBeNull();
    expect(root.querySelector("[data-endue-space]")).toBeNull();
  });

  it("lists the person's endue agents, working and waiting first, and their spaces", async () => {
    const { root, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    expect(ids(root, "data-endue-agent")).toEqual([
      sampleAgentId(1), // Miso: a conversation runs
      sampleAgentId(3), // Scout: online
      sampleAgentId(2), // Mailie: disabled
    ]);
    const miso = root.querySelector<HTMLElement>(`[data-endue-agent="${sampleAgentId(1)}"]`);
    expect(miso?.dataset.presence).toBe("working");
    expect(miso?.title).toBe("Miso · Working");
    expect(miso?.querySelector(".avatar-dot")).not.toBeNull();
    expect(miso?.style.getPropertyValue("--endue-accent")).toBe("#B6A3F5");
    const mailie = root.querySelector(`[data-endue-agent="${sampleAgentId(2)}"]`);
    expect(mailie?.classList.contains("is-paused")).toBe(true);
    expect(ids(root, "data-endue-space")).toEqual(["sp_sample001", "sp_sample002"]);
    expect(root.querySelector('[data-endue-space="sp_sample001"]')?.textContent).toBe("🚀");
    // The directory's own agents and spaces give way.
    expect(root.querySelector("[data-agent], [data-space]")).toBeNull();
    const labels = [...root.querySelectorAll(".rail-label")].map((l) => l.textContent);
    expect(labels).toEqual(["Agents", "Spaces"]);
  });

  it("opens an agent's or a space's window on a click", async () => {
    const { root, store, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    root.querySelector<HTMLButtonElement>(`[data-endue-agent="${sampleAgentId(3)}"]`)?.click();
    expect(store.get().focused).toBe(`endue-agent:${sampleAgentId(3)}`);
    expect(
      root.querySelector(`[data-endue-agent="${sampleAgentId(3)}"]`)?.getAttribute("aria-pressed"),
    ).toBe("true");
    root.querySelector<HTMLButtonElement>('[data-endue-space="sp_sample002"]')?.click();
    expect(store.get().focused).toBe("endue-space:sp_sample002");
  });

  it("says endue cannot be reached, and gives the directory back on signing out", async () => {
    const { root, ctx, bridge, signIn } = mounted();
    signIn();
    await settle();
    const studio = bridge.studio;
    if (!studio) throw new Error("the stub has studio");
    studio.agents = () => Promise.reject(new Error("down"));
    await loadEndue(ctx);
    expect(root.querySelector("[data-endue-agents] .bar-offline")).not.toBeNull();
    await bridge.account.signOut();
    await settle();
    expect(root.querySelector("[data-endue-agents]")).toBeNull();
  });
});
