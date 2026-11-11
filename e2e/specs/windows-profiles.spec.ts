// Profiles and the window manager (#82), the twin of packages/runtime/e2e/shell-profiles.spec.ts on
// the CEF desk where it touches windows: a profile switch lays out the windows the next profile
// places, on the desktops it names, in front of the plugin windows already there; it puts away in
// the drawer what the session opened and the next one places nowhere (ADR 0117), while the profile
// left takes its own windows with it and gives each plugin its own window back (#158). The first
// cases run on the desk as it starts, its plugins' windows in their slots; the others on an empty
// canvas. The switches go through desk.profiles.switch and every
// window is read through desk.windows.list. The rest of that file is the profile switcher's own
// chrome (the canvas hint, the row of many chips, the chips' menus and dialogs), which stays with
// the runtime e2e: no window moves in it.
import { browser, expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import {
  byId,
  clearDesk,
  closeShellWindows,
  type Desk,
  deskNow,
  front,
  inUse,
  onScreen,
  openWindow,
  rectOf,
  run,
  until,
} from "../support/windows";

/** plugins/shell's sample profile Review places Calendar and Tomorrow on desktop 1. */
const REVIEW = {
  id: "review",
  calendar: { x: 120, y: 260, w: 520, h: 380 },
  tomorrow: { x: 980, y: 240, w: 320, h: 360 },
};

const profileIs = async (id: string) => {
  const list = (await run("desk.profiles.list")) as { active?: string };
  return list.active === id;
};
const hidden = (desk: Desk, id: string) =>
  desk.windows.some((w) => w.id === id && w.hidden === true);

/** The sample profiles the switcher offers, in its order, then Default (#158's tour). */
const TOUR = ["night", "review", "morning", "deep-work", "studio", "builder-morning", "default"];

/**
 * desk.windows.list by window, but the ranks and the focus: where each is, on which desktop,
 * whether it waits in the drawer, what it shows. A plugin turned off and on again by the samples
 * comes back last in mount order, which moves the ranks.
 */
const listed = (desk: Desk) =>
  desk.windows
    .map((w) => {
      const panes = w.panes.map((p) => p.view).join("|");
      return `${w.id} ${w.desktop ?? "-"} ${w.hidden ? "away" : "on"} ${w.x},${w.y} ${w.w}x${w.h} ${panes}`;
    })
    .sort();

describe("profiles over the desk as it starts: the plugin windows in their slots (#158)", () => {
  before(async () => {
    await shellReady();
    await run("desk.shell.desktop-1");
    await until((d) => front(d).id === "1" && onScreen(d).length > 0, "the plugins' windows in");
  });
  after(async () => {
    await run("desk.profiles.switch", { id: "default" });
    await browser.waitUntil(() => profileIs("default"), { timeoutMsg: "Default not in force" });
    await until((d) => !onScreen(d).some((w) => w.id === "calendar"), "Review's windows gone");
  });

  it("a tour of the sample profiles ends on the desk it started from", async () => {
    // Settled: every plugin window of the start is in its slot.
    let start = listed(await deskNow());
    await browser.waitUntil(
      async () => {
        const now = listed(await deskNow());
        const same = now.join("\n") === start.join("\n");
        start = now;
        return same;
      },
      { timeout: 10_000, interval: 500, timeoutMsg: "the desk did not settle" },
    );
    for (const id of TOUR) {
      await run("desk.profiles.switch", { id });
      await browser.waitUntil(() => profileIs(id), { timeoutMsg: `${id} not in force` });
      // Nothing waits in the drawer at any step: no window of the start was put away.
      await until((d) => !d.windows.some((w) => w.hidden), `${id}: the drawer empty`);
    }
    await until(
      (d) => listed(d).join("\n") === start.join("\n"),
      `Default gives back the desk of the start: ${start.join("; ")}`,
      20_000,
    );
  });

  it("a profile's windows open in front of the windows already there, the last one in use", async () => {
    await run("desk.profiles.switch", { id: REVIEW.id });
    const desk = await until(
      (d) => onScreen(d).some((w) => w.id === "calendar") && inUse(d)?.id === "tomorrow",
      "Review's windows on desktop 1, Tomorrow in use",
    );
    const ranked = [...onScreen(desk)].sort((a, b) => (b.z ?? 0) - (a.z ?? 0)).map((w) => w.id);
    expect(ranked.slice(0, 2)).toEqual(["tomorrow", "calendar"]);
    expect(ranked.length).toBeGreaterThan(2);
  });
});

describe("profiles: what a profile switch does to the windows (#82)", () => {
  /** The window opened under Default, before the switch. */
  let mine = "";
  before(async () => {
    await shellReady();
    await clearDesk();
    // Desktop 1, unpanned: the one the sample profiles lay out.
    await run("desk.shell.desktop-1");
    await until((d) => front(d).id === "1", "desktop 1 in front");
  });
  after(async () => {
    await closeShellWindows();
  });

  it("a switch lays out the next profile's windows and puts away the ones it places nowhere", async () => {
    mine = await openWindow();
    await run("desk.profiles.switch", { id: REVIEW.id });
    const desk = await until(
      (d) => onScreen(d).some((w) => w.id === "calendar") && hidden(d, mine),
      "Review's windows on desktop 1 and the new window in the drawer",
    );
    expect(await profileIs(REVIEW.id)).toBe(true);
    const pan = front(desk).pan ?? { x: 0, y: 0 };
    const at = (r: typeof REVIEW.calendar) => ({ ...r, x: r.x + pan.x, y: r.y + pan.y });
    expect(rectOf(byId(desk, "calendar") as never)).toEqual(at(REVIEW.calendar));
    expect(rectOf(byId(desk, "tomorrow") as never)).toEqual(at(REVIEW.tomorrow));
    expect(byId(desk, "calendar")?.panes.map((p) => p.view)).toEqual(["calendar"]);
    expect(byId(desk, "calendar")?.state).toBe("normal");
    // The window it places nowhere waits in the drawer with its pane.
    const away = desk.windows.find((w) => w.id === mine && w.hidden);
    expect(away?.panes.map((p) => p.view)).toEqual(["launcher"]);
  });

  it("switching back, Review takes its windows with it; the one put away first still waits in the drawer", async () => {
    await run("desk.profiles.switch", { id: "default" });
    const desk = await until(
      (d) => !onScreen(d).some((w) => w.id === "calendar" || w.id === "tomorrow"),
      "Review's windows off desktop 1",
    );
    expect(await profileIs("default")).toBe(true);
    // Review's windows are not in the drawer: Review lays them out again when it is back (#158).
    expect(desk.windows.some((w) => w.id === "calendar" || w.id === "tomorrow")).toBe(false);
    // The window put away by the first switch still waits there: it was an edit of Default's
    // session, which a switch does not keep (the drawer brings it back: windows-windows).
    expect(hidden(desk, mine)).toBe(true);
  });
});
