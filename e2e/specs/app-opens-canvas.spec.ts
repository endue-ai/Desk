// An app opens on the canvas (#239, ADR 0226), on the CEF desk: examples/plugin-hello-window with
// `DESK_APP_WINDOWS=off`, which keeps every window on the canvas whatever its manifest says. Its
// window opens with a page of the 480 × 360 its manifest asks for, a resize stops at its smallest
// page (320 × 240), and it pops out into an OS window with the same page and its count. The twin
// of app-opens-out.spec.ts; the gestures go through the compositor's own input.
import { expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { drag, gripAt } from "../support/gestures";
import {
  APP,
  appWindow,
  count,
  countTo,
  framed,
  LEAST,
  PAGE,
  pageIs,
} from "../support/hello-window";
import { rectOf, run } from "../support/windows";

describe("an app that opens on the canvas", () => {
  it("opens in a window of the canvas, its page as large as its manifest asks", async () => {
    await shellReady();
    const w = await appWindow((w) => !w.hidden, "has no window");
    expect(w.out).toBeUndefined();
    expect({ w: w.w, h: w.h }).toEqual(framed(PAGE));
    await pageIs(PAGE);
    await countTo(3);
  });

  it("stops a resize at the smallest page its manifest asks", async () => {
    await run("desk.display.show", { plugin: APP });
    const before = await appWindow((w) => w.focused === true, "not in use");
    const grip = gripAt(rectOf(before), "se");
    await drag(grip, { x: grip.x - 400, y: grip.y - 400 });
    const small = await appWindow((w) => w.w !== before.w, "was not resized");
    expect({ w: small.w, h: small.h }).toEqual(framed(LEAST));
    await pageIs(LEAST);
  });

  it("pops out into an OS window with the same page and its count", async () => {
    await run("desk.windows.pop-out", { window: APP });
    const out = await appWindow((w) => w.out !== undefined, "never popped out");
    expect(out.out).toBeDefined();
    expect(await count()).toBe("3");
  });
});
