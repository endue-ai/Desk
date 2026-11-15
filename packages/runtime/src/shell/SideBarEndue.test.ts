// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { sampleAgentId } from "../bridge/studio-fixtures";
import { ManualClock } from "../clock";
import { settle, testDesk } from "../surface/endue/test-desk";
import { loadEndue, watchEndue } from "../system/endue";
import { mountSideBar } from "./SideBar";
import { Ticker } from "./ticker";

const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
});

function mounted() {
  const desk = testDesk();
  const root = document.createElement("div");
  document.body.append(root);
  const ticker = new Ticker(new ManualClock());
  desk.ctx.ticker = ticker;
  offs.push(mountSideBar(root, desk.ctx), watchEndue(desk.ctx), () => ticker.dispose());
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
    expect(miso?.getAttribute("aria-label")).toBe("Miso · Working");
    expect(miso?.style.getPropertyValue("--endue-accent")).toBe("#B6A3F5");
    const mailie = root.querySelector(`[data-endue-agent="${sampleAgentId(2)}"]`);
    expect(mailie?.classList.contains("is-paused")).toBe(true);
    expect(ids(root, "data-endue-space")).toEqual(["sp_sample001", "sp_sample002"]);
    expect(root.querySelector('[data-endue-space="sp_sample001"]')?.textContent).toBe("🚀");
    // The directory's own agents and spaces give way.
    expect(root.querySelector("[data-agent], [data-space]")).toBeNull();
  });

  it("shows each agent's face as the core hands it over, and its initial until then (ADR 0232)", async () => {
    const { root, signIn, studio, store, ctx } = mounted();
    const miso = sampleAgentId(1);
    const scout = sampleAgentId(3);
    // Scout's picture cannot be read; Mailie's is not a picture at all.
    delete studio.pictures[scout];
    studio.pictures[sampleAgentId(2)] = "https://cdn.endue.ai/c/mailie.png";
    signIn();
    await settle();
    await settle();
    await settle();
    const avatar = (id: string) => root.querySelector<HTMLElement>(`[data-endue-agent="${id}"]`);
    const face = avatar(miso)?.querySelector<HTMLImageElement>("img.avatar-face");
    expect(face?.getAttribute("src")).toBe(studio.pictures[miso]);
    expect(face?.getAttribute("src")).toMatch(/^data:image\/svg\+xml;base64,/);
    // The button's name says who it is: the picture adds nothing for a screen reader.
    expect(face?.getAttribute("alt")).toBe("");
    expect(avatar(miso)?.textContent).toBe("");
    expect(avatar(scout)?.querySelector("img")).toBeNull();
    expect(avatar(scout)?.textContent).toBe("S");
    expect(avatar(sampleAgentId(2))?.querySelector("img")).toBeNull();
    expect(Object.keys(store.get().endue.pictures)).toEqual([miso]);
    // A face that changed is drawn on the next read.
    studio.pictures[scout] = studio.pictures[miso] ?? "";
    await loadEndue(ctx);
    await settle();
    await settle();
    expect(avatar(scout)?.querySelector("img.avatar-face")).not.toBeNull();
    // Unfolded, a row shows the same face beside the name.
    store.set({ agentsPinned: true });
    const row = root.querySelector<HTMLElement>(`.bar-row[data-endue-agent="${miso}"]`);
    expect(row?.querySelector(".bar-face img.avatar-face")?.getAttribute("src")).toBe(
      studio.pictures[miso],
    );
  });

  it("signed in, the bar has no caption and no dot, and the ring's state is `data-presence`", async () => {
    const { root, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    const bar = root.querySelector<HTMLElement>(".sidebar");
    expect(bar?.querySelector(".rail-label")).toBeNull();
    expect(bar?.querySelector(".avatar-dot, .dot")).toBeNull();
    expect(
      [...(bar?.children ?? [])].map((part) =>
        part.getAttribute("role") === "group"
          ? part.getAttribute("aria-label")
          : part.getAttribute("role"),
      ),
    ).toEqual([null, "Agents", "separator", "Spaces"]);
    expect(bar?.firstElementChild?.getAttribute("data-key")).toBe("agents-unfold");
    const presence = (n: number) =>
      root.querySelector<HTMLElement>(`[data-endue-agent="${sampleAgentId(n)}"]`)?.dataset.presence;
    // As `enduePresence` says: Miso's conversation runs, Scout is online, Mailie is disabled.
    expect([presence(1), presence(3), presence(2)]).toEqual(["working", "online", "paused"]);
  });

  it("an endue agent's tooltip says its name and, while it works, the conversation and its time", async () => {
    const { root, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    const tooltip = root.querySelector<HTMLElement>('[role="tooltip"]');
    const lines = () => [...(tooltip?.children ?? [])].map((line) => line.textContent);
    const over = (selector: string) =>
      root.querySelector(selector)?.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(tooltip?.hidden).toBe(true);
    over(`[data-endue-agent="${sampleAgentId(1)}"]`);
    expect(tooltip?.hidden).toBe(false);
    // The wall clock stands at the fixture's epoch: the conversation's last message was 2 minutes ago.
    expect(lines()).toEqual(["Miso · Working", "Move Friday's dentist · 2:00"]);
    over(`[data-endue-agent="${sampleAgentId(3)}"]`);
    expect(lines()).toEqual(["Scout · Online"]);
    over('[data-endue-space="sp_sample001"]');
    expect(lines()).toEqual(["Launch space", "Ship the launch page and its first mail"]);
    // Three agents and two spaces, and the unfold control before them.
    expect(root.querySelectorAll(".sidebar button")).toHaveLength(6);
    expect(root.querySelector(".sidebar button[title]")).toBeNull();
  });

  it("signed in, the list names the endue agents with their presence and the conversation one works on", async () => {
    const { root, store, signIn } = mounted();
    signIn();
    await settle();
    await settle();
    expect(root.querySelector(".bar-row")).toBeNull();
    store.set({ agentsPinned: true });
    const says = (selector: string) => {
      const row = root.querySelector<HTMLElement>(`.bar-row${selector}`);
      return [".bar-row-name", ".bar-row-note", ".bar-row-time"].map(
        (part) => row?.querySelector(part)?.textContent ?? null,
      );
    };
    // Miso's conversation runs, its last message 2 minutes before; the others say their presence.
    expect(says(`[data-endue-agent="${sampleAgentId(1)}"]`)).toEqual([
      "Miso",
      "Move Friday's dentist",
      "2:00",
    ]);
    expect(says(`[data-endue-agent="${sampleAgentId(3)}"]`)).toEqual(["Scout", "Online", null]);
    expect(says(`[data-endue-agent="${sampleAgentId(2)}"]`)).toEqual(["Mailie", "Paused", null]);
    // A row is the avatar's own control: its key, its name, its state and its colour.
    const miso = root.querySelector<HTMLElement>(
      `.bar-row[data-endue-agent="${sampleAgentId(1)}"]`,
    );
    expect(miso?.dataset.key).toBe(`endue-agent-${sampleAgentId(1)}`);
    expect(miso?.getAttribute("aria-label")).toBe("Miso · Working");
    expect(miso?.querySelector<HTMLElement>(".bar-face")?.dataset.presence).toBe("working");
    expect(miso?.style.getPropertyValue("--endue-accent")).toBe("#B6A3F5");
    // A space's row says its name, under the caption its group has.
    expect(says('[data-endue-space="sp_sample001"]')).toEqual(["Launch", null, null]);
    expect(
      root.querySelector('.bar-row[data-endue-space="sp_sample001"]')?.getAttribute("aria-label"),
    ).toBe("Launch space");
    expect([...root.querySelectorAll(".bar-caption")].map((c) => c.textContent)).toEqual([
      "Agents",
      "Spaces",
    ]);
    // The words are endue's own for the others: an agent that waits for the person, one offline.
    store.set((s) => ({
      endue: {
        ...s.endue,
        conversations: s.endue.conversations.map((c) =>
          c.agentId === sampleAgentId(3) ? { ...c, activity: "waiting" as const } : c,
        ),
      },
    }));
    expect(says(`[data-endue-agent="${sampleAgentId(3)}"]`)).toEqual(["Scout", "Needs you", null]);
    // Pressing a row opens the window its avatar opens.
    root.querySelector<HTMLElement>(`.bar-row[data-endue-agent="${sampleAgentId(3)}"]`)?.click();
    expect(store.get().focused).toBe(`endue-agent:${sampleAgentId(3)}`);
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
