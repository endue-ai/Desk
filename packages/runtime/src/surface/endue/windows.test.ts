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
const boardRow = (el: HTMLElement, id: string) =>
  face(el, "back")?.querySelector<HTMLElement>(`[data-row="${id}"]`);
const press = (el: HTMLElement, selector: string) =>
  face(el, "back")?.querySelector<HTMLButtonElement>(selector)?.click();

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

  it("shows the agent's face on its card once the core has read it (ADR 0232)", async () => {
    const { el, studio } = await mounted("agent", MISO);
    await settle();
    const picture = face(el, "front")?.querySelector<HTMLImageElement>(".endue-avatar img");
    expect(picture?.getAttribute("src")).toBe(studio.pictures[MISO]);
    expect(face(el, "front")?.querySelector(".endue-avatar")?.textContent).toBe("");
  });

  it("turns over to the Studio board on Studio, and back on Card", async () => {
    const { el, store } = await mounted("agent", MISO);
    click(el, "studio", "front");
    await settle();
    const card = el.querySelector(".endue-flip");
    expect(card?.classList.contains("is-flipped")).toBe(true);
    expect(store.get().endue.flipped).toEqual([`endue-agent:${MISO}`]);
    expect(face(el, "front")?.hasAttribute("inert")).toBe(true);
    expect(face(el, "back")?.hasAttribute("inert")).toBe(false);
    const back = face(el, "back");
    // Three columns, as endue.ai's Studio has them, the agent's sheet in the middle.
    expect(
      [...(back?.querySelectorAll(".studio-col-head") ?? [])].map((h) => h.textContent),
    ).toEqual(["01Where requests come in", "02Where the agent handles them", "03What it reaches"]);
    expect(
      [...(back?.querySelectorAll("[data-col='in'] [data-row]") ?? [])].map((r) =>
        r.getAttribute("data-row"),
      ),
    ).toEqual(["console", "channel", "live", "api", "mcp"]);
    expect(
      [...(back?.querySelectorAll("[data-col='out'] [data-row]") ?? [])].map((r) =>
        r.getAttribute("data-row"),
      ),
    ).toEqual(["devices", "outputs"]);
    const hub = back?.querySelector("[data-hub]");
    expect(hub?.querySelector(".studio-name")?.textContent).toBe("Miso");
    expect(hub?.querySelector(".studio-status")?.textContent).toBe("Working");
    expect(hub?.querySelector(".studio-handle")?.textContent).toBe(
      "@miso · Keeps my calendar and sorts my mail",
    );
    expect(hub?.querySelector(".studio-sentence")?.textContent).toBe(
      "Takes requests from Console chat, handles them with 2 built-in tools, and leaves results in Outputs.",
    );
    expect(hub?.querySelector('[data-section="prompt"] .studio-sheet-value')?.textContent).toBe(
      "“Answer briefly, in Korean.”",
    );
    expect(hub?.querySelector('[data-section="model"] .studio-sheet-value')?.textContent).toBe(
      "claude-sonnet-4.5",
    );
    expect(hub?.querySelector(".studio-portrait img")?.getAttribute("src")).toMatch(
      /^data:image\//,
    );
    // The lines' layer is there, drawn over the board and out of a screen reader's way.
    expect(back?.querySelector("svg.studio-lines")?.getAttribute("aria-hidden")).toBe("true");
    expect(back?.querySelectorAll("svg.studio-lines [data-line]").length).toBeGreaterThan(0);
    // The focus follows the turn to the face now in front.
    expect(document.activeElement?.getAttribute("data-action")).toBe("card");

    click(el, "card", "back");
    await settle();
    expect(el.querySelector(".endue-flip")?.classList.contains("is-flipped")).toBe(false);
    expect(document.activeElement?.getAttribute("data-action")).toBe("studio");
  });

  it("unfolds a way in where it stands, one at a time, and keeps the focus on it", async () => {
    const { el } = await mounted("agent", MISO);
    click(el, "studio", "front");
    await settle();
    const head = (id: string) =>
      boardRow(el, id)?.querySelector<HTMLButtonElement>("[data-row-head]");
    expect(head("live")?.getAttribute("aria-expanded")).toBe("false");
    head("live")?.focus();
    head("live")?.click();
    expect(head("live")?.getAttribute("aria-expanded")).toBe("true");
    expect(boardRow(el, "live")?.querySelector(".studio-row-body p")?.textContent).toBe(
      "Turn it on to chat at endue.live/@miso.",
    );
    expect(document.activeElement).toBe(head("live"));
    head("mcp")?.click();
    expect(head("live")?.getAttribute("aria-expanded")).toBe("false");
    expect(boardRow(el, "live")?.querySelector(".studio-row-body")).toBeNull();
    expect(boardRow(el, "mcp")?.hasAttribute("data-expanded")).toBe(true);
    head("mcp")?.click();
    expect(boardRow(el, "mcp")?.hasAttribute("data-expanded")).toBe(false);
  });

  it("opens each part of endue.ai's Studio from the board, and nothing off endue.ai", async () => {
    const { el, bridge } = await mounted("agent", MISO);
    click(el, "studio", "front");
    await settle();
    const studio = `https://endue.ai/agent/${MISO}/studio`;
    press(el, '[data-section="prompt"]');
    await settle();
    press(el, '[data-row="devices"] [data-row-head]');
    await settle();
    press(el, '[data-key="studio-foot-settings"]');
    await settle();
    press(el, '[data-row="channel"] [data-row-head]');
    press(el, '[data-row="channel"] [data-row-action="add"]');
    await settle();
    press(el, '[data-row="console"] [data-row-head]');
    press(el, '[data-row="console"] [data-row-action="open"]');
    await settle();
    expect(bridge.fake.opened).toEqual([
      `${studio}/prompt`,
      `${studio}/devices`,
      `${studio}/settings`,
      `${studio}/channel`,
      `https://endue.ai/agent/${MISO}`,
    ]);
  });

  it("opens the agent's own page and its Studio on endue.ai, and nothing else", async () => {
    const { el, bridge } = await mounted("agent", MISO);
    // No Browser in this desk: the pages go to the system browser (ADR 0223).
    click(el, "open-agent", "front");
    await settle();
    click(el, "open-web", "front");
    await settle();
    expect(bridge.fake.opened).toEqual([
      `https://endue.ai/agent/${MISO}`,
      `https://endue.ai/agent/${MISO}/studio`,
    ]);
    const labels = [
      ...(face(el, "front")?.querySelectorAll(".endue-actions [data-action]") ?? []),
    ].map((b) => b.textContent);
    expect(labels).toEqual(["Agent page", "Studio page"]);
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
    expect(face(el, "back")?.querySelector(".studio-col-head")?.textContent).toBe(
      "01요청이 들어오는 곳",
    );
    expect(boardRow(el, "console")?.querySelector(".studio-row-title")?.textContent).toBe(
      "콘솔 채팅",
    );
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
