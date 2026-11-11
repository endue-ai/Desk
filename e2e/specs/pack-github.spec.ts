// "Set up GitHub" (#161, finding 5; ADR 0108): Apply on the proposal card leaves the person in front of
// the next step. desk.github has no account here, so that is Settings, Connections on it, the token
// form, with nothing above it in the compositor's system layer: the board it opens waits on the card,
// which once covered the form whole. Escape closes the form the person sees, and Undo on the card,
// pressed by pointer, puts back the profile and every window desk.windows.list named before Apply.
// The card and the form are read in the desk's page; no token is ever typed.
import { browser, expect } from "@wdio/globals";
import { feed, shellCommand } from "../support/compositor";
import { shellReady } from "../support/desk";
import type { Point } from "../support/gestures";
import { type Desk, deskNow, run } from "../support/windows";

interface Stats {
  system: {
    /** The system layer back to front: the page's own plugin surfaces by plugin, its page as desk. */
    order: string[];
    /** The desk page's parts drawn whole above every window. */
    parts: string[];
    plugins: Array<{ plugin: string; shown: boolean; layer: string }>;
  };
}

const stats = () => shellCommand<Stats>("compositor_stats");
const ESCAPE = [
  { type: "key", key: "Escape", code: "Escape", pressed: true },
  { type: "key", key: "Escape", code: "Escape", pressed: false },
];
const profile = async () => ((await run("desk.profiles.list")) as { active?: string }).active;

/** A click through the compositor's input, as the person's pointer. */
async function press(p: Point): Promise<void> {
  const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
  await feed([{ type: "pointerMoved", x: Math.round(p.x), y: Math.round(p.y) }, button(true)]);
  await feed([button(false)]);
}

/** The middle of the proposal card's button `selector` once it can be pressed. */
async function cardButton(selector: string): Promise<Point> {
  let at: Point | null = null;
  await browser.waitUntil(
    async () => {
      at = await browser.execute((s: string) => {
        const b = document.querySelector<HTMLButtonElement>(`section.proposal ${s}`);
        if (!b || b.disabled) return null;
        const r = b.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, selector);
      return at !== null;
    },
    { timeout: 10_000, timeoutMsg: `the card shows no ${selector}` },
  );
  return at as unknown as Point;
}

/** What a person sees of the windows: each one's place, desktop, state, panes and whether put away. */
const seen = (desk: Desk) =>
  desk.windows.map((w) => ({
    id: w.id,
    desktop: w.desktop,
    rect: [w.x, w.y, w.w, w.h],
    z: w.z,
    state: w.state,
    hidden: w.hidden === true,
    panes: w.panes.map((p) => p.view),
  }));

/** The section Settings shows, or null while it is closed. */
const settingsOpen = () =>
  browser.execute(
    () =>
      document.querySelector("dialog.desk-settings[open] #desk-settings-title")?.textContent ??
      null,
  );

describe("Set up GitHub: the token form in front, and Undo takes Apply back (#161)", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("Apply leaves Settings, Connections as the front layer; Undo puts back the profile and the windows", async () => {
    const before = { profile: await profile(), windows: seen(await deskNow()) };
    const setUp = run("desk.pack.setup", { service: "github" });
    await press(await cardButton('[data-choice="apply"]'));
    expect(await setUp).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(await profile()).toBe("builder-morning");
    await browser.waitUntil(async () => (await settingsOpen()) === "Connections", {
      timeout: 10_000,
      timeoutMsg: "Settings is not open on Connections",
    });
    await browser.waitUntil(async () => (await stats()).system.parts.includes("desk.settings"), {
      timeout: 10_000,
      timeoutMsg: "the compositor draws no Settings",
    });
    const { system } = await stats();
    // The desk's page is the front of the system layer, and no overlay is shown over it.
    expect(system.order.at(-1)).toBe("desk");
    expect(system.plugins.filter((p) => p.layer === "overlay" && p.shown)).toEqual([]);
    // The token form is GitHub's, first in the list.
    expect(
      await browser.execute(
        () =>
          document.querySelector<HTMLElement>("dialog.desk-settings[open] [data-connector]")
            ?.dataset.connector,
      ),
    ).toBe("desk.github");
    // The profile laid no window out: the windows are the ones before Apply.
    expect(seen(await deskNow())).toEqual(before.windows);

    // Escape closes the form the person sees; the card then names the next step.
    await feed(ESCAPE);
    await browser.waitUntil(async () => (await settingsOpen()) === null, {
      timeout: 5_000,
      timeoutMsg: "Escape left Settings open",
    });
    expect(
      await browser.execute(
        () => document.querySelector("section.proposal .proposal-note")?.textContent,
      ),
    ).toBe("GitHub is on. Put your token in Settings, Connections, then open GitHub board here.");

    // Undo, by pointer: the profile and the windows as before Apply, the card gone.
    await press(await cardButton('[data-action="undo"]'));
    await browser.waitUntil(
      async () =>
        (await browser.execute(() => document.querySelector("section.proposal"))) === null,
      { timeout: 10_000, timeoutMsg: "the card stayed after Undo" },
    );
    expect(await profile()).toBe(before.profile);
    expect(seen(await deskNow())).toEqual(before.windows);
  });
});
