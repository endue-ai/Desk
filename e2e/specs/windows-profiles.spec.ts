// Profiles and the window manager (#82), the twin of packages/runtime/e2e/shell-profiles.spec.ts on
// the CEF desk where it touches windows: a profile switch lays out the windows the next profile
// places, on the desktops it names, and puts away in the drawer those it places nowhere (ADR 0117),
// both ways. The switches go through desk.profiles.switch and every
// window is read through desk.windows.list. The rest of that file is the profile switcher's own
// chrome (the canvas hint, the row of many chips, the chips' menus and dialogs), which stays with
// the runtime e2e: no window moves in it.
import { expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import {
  byId,
  clearDesk,
  closeShellWindows,
  type Desk,
  front,
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

  it("switching back puts the profile's windows in the drawer too, beside the one put away first", async () => {
    await run("desk.profiles.switch", { id: "default" });
    const desk = await until(
      (d) => !onScreen(d).some((w) => w.id === "calendar" || w.id === "tomorrow"),
      "Review's windows off desktop 1",
    );
    expect(await profileIs("default")).toBe(true);
    // Review's windows wait in the drawer now, where Default does not place them.
    expect(hidden(desk, "calendar")).toBe(true);
    expect(hidden(desk, "tomorrow")).toBe(true);
    // The window put away by the first switch still waits there: it was an edit of Default's
    // session, which a switch does not keep (the drawer brings it back: windows-windows).
    expect(hidden(desk, mine)).toBe(true);
  });
});
