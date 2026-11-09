// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { sampleAgentId } from "../../bridge/studio-fixtures";
import { loadEndue } from "../../system/endue";
import { endueAgentBody } from "./agent";
import { endueSpaceBody } from "./space";
import { settle, testDesk } from "./test-desk";

const MISO = sampleAgentId(1);
const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
  document.body.replaceChildren();
});

async function mounted(body: "agent" | "space", id: string, lang: "en" | "ko" = "en") {
  const desk = testDesk(lang);
  desk.signIn();
  await loadEndue(desk.ctx);
  const { el, off } =
    body === "agent" ? endueAgentBody(desk.ctx, id) : endueSpaceBody(desk.ctx, id);
  if (off) offs.push(off);
  document.body.append(el);
  await settle();
  return { ...desk, el };
}

const face = (el: HTMLElement, side: "front" | "back") =>
  el.querySelector<HTMLElement>(`[data-face="${side}"]`);
const click = (el: HTMLElement, action: string, side: "front" | "back") =>
  face(el, side)?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)?.click();
const fact = (el: HTMLElement, key: string) =>
  el.querySelector(`[data-fact="${key}"] dd`)?.textContent;

describe("an endue agent's window (ADR 0129)", () => {
  it("shows the agent's card: name, handle and role, presence, description and chips", async () => {
    const { el } = await mounted("agent", MISO);
    const front = face(el, "front");
    expect(front?.querySelector(".endue-title")?.textContent).toBe("Miso");
    expect(front?.querySelector(".endue-badge")?.textContent).toBe("endue");
    expect(front?.querySelector(".endue-handle")?.textContent).toBe(
      "@miso · Keeps my calendar and sorts my mail",
    );
    expect(front?.querySelector(".endue-presence")?.textContent).toBe("Working");
    expect(
      [...(front?.querySelectorAll(".endue-chips li") ?? [])].map((c) => c.textContent),
    ).toEqual(["claude-sonnet-4.5"]);
    expect(front?.hasAttribute("inert")).toBe(false);
    expect(face(el, "back")?.hasAttribute("inert")).toBe(true);
    expect(face(el, "back")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("turns over to Studio on Studio, with its status, and back on Card", async () => {
    const { el, store } = await mounted("agent", MISO);
    click(el, "studio", "front");
    await settle();
    const card = el.querySelector(".endue-flip");
    expect(card?.classList.contains("is-flipped")).toBe(true);
    expect(store.get().endue.flipped).toEqual([`endue-agent:${MISO}`]);
    expect(face(el, "front")?.hasAttribute("inert")).toBe(true);
    expect(face(el, "back")?.hasAttribute("inert")).toBe(false);
    expect(fact(el, "status")).toBe("Active");
    expect(fact(el, "presence")).toBe("Working");
    expect(fact(el, "model")).toBe("claude-sonnet-4.5");
    expect(fact(el, "visibility")).toBe("Private");
    expect(fact(el, "prompt")).toBe("Revision 1");
    expect(fact(el, "conversations")).toBe("1 active · 0 waiting · 0 failed · 1 done");
    // The focus follows the turn to the face now in front.
    expect(document.activeElement?.getAttribute("data-action")).toBe("card");

    click(el, "card", "back");
    await settle();
    expect(el.querySelector(".endue-flip")?.classList.contains("is-flipped")).toBe(false);
    expect(document.activeElement?.getAttribute("data-action")).toBe("studio");
  });

  it("opens the agent's Studio on endue.ai and nothing else", async () => {
    const { el, bridge } = await mounted("agent", MISO);
    click(el, "open-web", "front");
    await settle();
    expect(bridge.fake.opened).toEqual([`https://endue.ai/agent/${MISO}/studio`]);
  });

  it("speaks the desk's language on both faces", async () => {
    const { el } = await mounted("agent", MISO, "ko");
    expect(face(el, "front")?.querySelector('[data-action="studio"]')?.textContent).toBe(
      "스튜디오",
    );
    expect(face(el, "front")?.querySelector(".endue-presence")?.textContent).toBe("일하는 중");
    click(el, "studio", "front");
    await settle();
    expect(face(el, "back")?.querySelector('[data-action="card"]')?.textContent).toBe("카드로");
    expect(fact(el, "status")).toBe("켜짐");
  });

  it("shows a notice once the desk is signed out", async () => {
    const { el, ctx, bridge } = await mounted("agent", MISO);
    await bridge.account.signOut();
    await loadEndue(ctx);
    expect(el.querySelector(".endue-notice")?.textContent).toBe("Sign in to see it again");
  });
});

describe("an endue space's window (ADR 0129)", () => {
  it("shows the space's card: glyph, goal, front desk, agents and what is open", async () => {
    const { el } = await mounted("space", "sp_sample001");
    const front = face(el, "front");
    expect(front?.querySelector(".endue-avatar")?.textContent).toBe("🚀");
    expect(front?.querySelector(".endue-handle")?.textContent).toBe("Front desk · Miso");
    expect(front?.querySelector(".endue-desc")?.textContent).toBe(
      "Ship the launch page and its first mail",
    );
    expect(front?.querySelectorAll(".endue-members .endue-member")).toHaveLength(3);
    expect(
      [...(front?.querySelectorAll(".endue-chips li") ?? [])].map((c) => c.textContent),
    ).toEqual(["Agents · 3", "In progress · 2", "Needs you · 1"]);
  });

  it("turns over to the space's status, work, results and rooms", async () => {
    const { el } = await mounted("space", "sp_sample001");
    click(el, "studio", "front");
    await settle();
    expect(fact(el, "status")).toBe("Active");
    expect(fact(el, "attention")).toBe("1");
    expect(fact(el, "rooms")).toBe("2 · 3 unread · 1 discussing");
    const titles = (list: string) =>
      [...el.querySelectorAll(`[data-list="${list}"] .endue-line-title`)].map((l) => l.textContent);
    expect(titles("work")).toEqual(["Write the first mail", "Pick the hero image"]);
    expect(titles("results")).toEqual(["Launch page draft", "Competitor table"]);
    expect(titles("rooms")).toEqual(["Copy", "Research"]);
  });

  it("opens one of the person's own agents from the space's Studio", async () => {
    const { el, store } = await mounted("space", "sp_sample001");
    click(el, "studio", "front");
    await settle();
    el.querySelector<HTMLButtonElement>(`[data-member="${sampleAgentId(3)}"]`)?.click();
    expect(store.get().focused).toBe(`endue-agent:${sampleAgentId(3)}`);
  });

  it("names a part endue AI did not answer for", async () => {
    const desk = testDesk();
    desk.signIn();
    const launch = desk.studio.spaces[0];
    if (!launch) throw new Error("a sample space");
    launch.detail.rooms = [];
    launch.detail.problems = [
      { part: "rooms", code: "offline", message: "endue AI did not answer" },
    ];
    await loadEndue(desk.ctx);
    const { el, off } = endueSpaceBody(desk.ctx, "sp_sample001");
    if (off) offs.push(off);
    document.body.append(el);
    await settle();
    expect(face(el, "back")?.querySelector('[role="alert"]')?.textContent).toBe(
      "Rooms: endue AI did not answer",
    );
  });
});
