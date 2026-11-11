// What the desk's page draws over the dock and the windows takes its own presses (#158, #159): the
// talk pill and its line, the Drawer button, the arrange strip and every other control of the page
// outside its windows is a part of the system layer (ADR 0160), so the compositor gives the press
// and the keys to the page alone, never also to the dock's tile or the window lying under it. The
// pointer and the keys are fed as winit would hand them over; who hears the pointer is the
// compositor's `compositor_input_state`.
import { browser, expect } from "@wdio/globals";
import { click, feed, inputState, keyPress } from "../support/compositor";
import { shellReady } from "../support/desk";
import { deskNow } from "../support/windows";

interface Control {
  name: string;
  x: number;
  y: number;
}

/** Every control the page shows outside its windows, at the middle of what of it is in the app,
 * where the page itself has nothing over it. */
const controls = () =>
  browser.execute((): Control[] => {
    const out: Control[] = [];
    const [w, h] = [window.innerWidth, window.innerHeight];
    const all = document.querySelectorAll<HTMLElement>(
      '#desk.shell button, #desk.shell input, #desk.shell [role="button"], #desk.shell a[href]',
    );
    for (const el of all) {
      // A window's own controls are drawn and heard with their window.
      if (el.closest("section.surface, [data-surface-host]")) continue;
      if (!el.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      const r = el.getBoundingClientRect();
      const [x0, y0] = [Math.max(r.left, 0), Math.max(r.top, 0)];
      const [x1, y1] = [Math.min(r.right, w), Math.min(r.bottom, h)];
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const [x, y] = [Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)];
      const top = document.elementFromPoint(x, y);
      if (!top || !el.contains(top)) continue;
      const label = el.getAttribute("aria-label") || el.title || el.textContent?.trim();
      out.push({ name: `${el.className}: ${(label ?? "").slice(0, 30)}`, x, y });
    }
    return out;
  });

/** Who hears the pointer at `at`. */
async function hearing(at: { x: number; y: number }): Promise<string[]> {
  await feed([{ type: "pointerMoved", x: at.x, y: at.y }]);
  return (await inputState()).pointer.hearing;
}

/** The box of the page's first element `selector` finds, and its middle. */
const box = (selector: string) =>
  browser.execute((selector: string) => {
    const r = document.querySelector(selector)?.getBoundingClientRect();
    if (!r) return null;
    return {
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      cx: r.x + r.width / 2,
      cy: r.y + r.height / 2,
    };
  }, selector);

/** The windows of the desk, by id: a dock tile pressed by mistake opens or closes one. */
const windowIds = async () => (await deskNow()).windows.map((w) => w.id).sort();

const typed = () =>
  browser.execute(() => document.querySelector<HTMLInputElement>(".composer-input")?.value ?? null);

describe("system parts: what the desk draws over the dock and the windows takes its own presses", () => {
  before(async () => {
    await shellReady();
    await feed([{ type: "windowFocused", focused: true }]);
    // The dock lies along the bottom edge, under the pill, the Drawer button and the strip's end.
    await browser.waitUntil(async () => (await box("[data-surface-host*='endue-dock']")) !== null, {
      timeoutMsg: "the dock never showed",
    });
  });

  it("lets only the desk hear the pointer on each control it draws outside its windows", async () => {
    const found = await controls();
    const names = found.map((c) => c.name).join("\n");
    for (const want of ["drawer-button", "talk-launch", "arrange-button"])
      expect(names).toContain(want);
    const others: string[] = [];
    for (const control of found) {
      const heard = await hearing(control);
      if (heard.join() !== "desk")
        others.push(`${control.name} at ${control.x},${control.y}: ${heard}`);
    }
    expect(others).toEqual([]);
  });

  it("puts what is typed after a press on the talk pill in its line, and presses no dock tile", async () => {
    const before = await windowIds();
    const pill = await box(".composer.talk-pill");
    if (!pill) throw new Error("no talk pill");
    await feed([{ type: "pointerMoved", x: pill.cx, y: pill.cy }]);
    // The pill widens under the pointer; a press on it, past its buttons, opens its line.
    await browser.pause(400);
    const wide = await box(".composer.talk-pill");
    if (!wide) throw new Error("no talk pill");
    await click([wide.cx, wide.cy]);
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector(".composer.is-open") !== null),
      { timeoutMsg: "the talk line never opened" },
    );
    const type = (text: string) =>
      feed([...text].flatMap((c) => keyPress(c, `Key${c.toUpperCase()}`, c)));
    await type("hel");
    await browser.waitUntil(async () => (await typed()) === "hel", {
      timeoutMsg: "what was typed never reached the talk line",
    });
    // A press inside the open line's field, where the dock's tiles lie under it, stays in the line.
    let field = await box(".composer-input");
    await browser.waitUntil(
      async () => {
        const was = field;
        await browser.pause(100);
        field = await box(".composer-input");
        return field !== null && JSON.stringify(field) === JSON.stringify(was);
      },
      { timeoutMsg: "the talk line never stopped growing" },
    );
    const dock = await box("[data-surface-host*='endue-dock']");
    if (!field || !dock) throw new Error("no talk line or dock");
    // Past the text, on its line: the caret goes to the end.
    const inside = { x: Math.round(field.x + field.w * 0.8), y: Math.round(field.cy) };
    expect(inside.y).toBeGreaterThanOrEqual(dock.y);
    expect(await hearing(inside)).toEqual(["desk"]);
    await click([inside.x, inside.y]);
    await type("lo");
    await browser.waitUntil(async () => (await typed()) === "hello", {
      timeoutMsg: `what was typed after the press at ${inside.x},${inside.y} left the talk line`,
    });
    expect((await inputState()).focused).toBe("desk");
    await feed(keyPress("Escape", "Escape"));
    await browser.pause(400);
    expect(await windowIds()).toEqual(before);
  });

  it("gives the keys to the desk for a press on the Drawer button, and presses no dock tile for Restore", async () => {
    const before = await windowIds();
    const restore = await box(".arrange-button.is-restore");
    if (!restore) throw new Error("no Restore button");
    await click([restore.cx, restore.cy]);
    await browser.pause(400);
    expect(await windowIds()).toEqual(before);
    const drawer = await box(".drawer-button");
    if (!drawer) throw new Error("no Drawer button");
    await click([drawer.cx, drawer.cy]);
    await browser.waitUntil(
      () => browser.execute(() => document.querySelector(".drawer-panel") !== null),
      { timeoutMsg: "the drawer never opened" },
    );
    expect((await inputState()).focused).toBe("desk");
    await feed(keyPress("Escape", "Escape"));
    expect(await windowIds()).toEqual(before);
  });
});
