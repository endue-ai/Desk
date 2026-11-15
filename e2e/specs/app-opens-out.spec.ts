// An app opens out of the canvas as its manifest says (#239, ADR 0226), on the CEF desk:
// examples/plugin-hello-window asks for `opens: "out"` and a page of 480 × 360. Its window is out
// from the start with a page of that size, the same page counts and calls the bridge there, it
// docks to the canvas at the same page size with its count, and showing it while it is out puts
// its OS window in use instead of opening another on the canvas. The windows are read through
// desk.windows.list and the page in its own DevTools target, so no OS focus is needed.
import { $, browser, expect } from "@wdio/globals";
import { inFrame, shellReady } from "../support/desk";
import { APP, appWindow, count, countTo, framed, PAGE, pageIs } from "../support/hello-window";
import { deskNow, openWindow, run } from "../support/windows";

describe("an app that opens out of the canvas", () => {
  it("opens in an OS window of its own, its page as large as its manifest asks", async () => {
    await shellReady();
    const out = await appWindow((w) => w.out !== undefined, "never popped out");
    expect(out.out).toBeDefined();
    await pageIs(PAGE);
  });

  it("runs the same page there: it counts into plugin state and calls the bridge", async () => {
    await countTo(2);
    const bridge = () => inFrame(APP, () => $("[data-testid=bridge]").getText());
    await browser.waitUntil(async () => (await bridge()).startsWith("bridge: ok"), {
      timeoutMsg: "its bridge call never answered out of the canvas",
    });
  });

  it("is shown where it is: desk.display.show puts its OS window in use and opens no other", async () => {
    const other = await openWindow();
    const before = (await deskNow()).windows.map((w) => w.id).sort();
    expect(before).toContain(other);
    await run("desk.display.show", { plugin: APP });
    const shown = await appWindow((w) => w.focused === true, "not in use after desk.display.show");
    expect(shown.out).toBeDefined();
    expect((await deskNow()).windows.map((w) => w.id).sort()).toEqual(before);
    await run("desk.windows.close", { window: other });
  });

  it("docks to the canvas at the same page size, with its count", async () => {
    await run("desk.windows.dock", { window: APP });
    const docked = await appWindow((w) => w.out === undefined, "never docked");
    expect({ w: docked.w, h: docked.h }).toEqual(framed(PAGE));
    await pageIs(PAGE);
    expect(await count()).toBe("2");
  });
});
