// DESK_APP_WINDOWS on the CEF desk (#235, ADR 0205): the plugins the switch names open out of the
// canvas, in OS windows of their own, the first time their window shows in a session; the others
// stay on the canvas, and one the person docks stays docked. wdio.conf.ts starts this spec's desk
// with the switch naming e2e.hello. Read as windows-out.spec.ts reads the desk: nothing needs the
// OS to show or focus a window.
import { browser, expect } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { appWindows, appWindowUntil } from "../support/out";
import { byId, deskNow, run, until, windowUntil } from "../support/windows";

const HELLO = "e2e.hello";
const NOTES = "endue.notes";

// Windows out of the canvas on Windows and Linux are the "every OS" track, out of #235's scope.
const mac = process.platform === "darwin";

(mac ? describe : describe.skip)(
  "out: DESK_APP_WINDOWS names the plugins that open out (#235)",
  () => {
    before(async () => {
      await shellReady();
    });

    it("the plugin it names opens in an OS window of its own, and the others on the canvas", async () => {
      const out = await windowUntil(HELLO, (w) => w.out !== undefined, "out as the desk started");
      expect(out.panes[0]?.plugin).toBe(HELLO);
      expect(await appWindowUntil(HELLO)).toMatchObject({ window: HELLO, title: "E2E Hello" });
      const desk = await until((d) => byId(d, NOTES) !== undefined, "Notes's window");
      expect(desk.windows.filter((w) => w.out).map((w) => w.id)).toEqual([HELLO]);
      expect((await appWindows()).map((w) => w.window)).toEqual([HELLO]);
    });

    it("docked, it stays on the canvas: the switch pops a window out once a session", async () => {
      await run("desk.windows.dock", { window: HELLO });
      await windowUntil(HELLO, (w) => w.out === undefined, "docked");
      await appWindowUntil(HELLO, false);
      // Long enough for the compositor's next plans to have handed the window out again.
      await browser.pause(1_500);
      expect(byId(await deskNow(), HELLO)?.out).toBeUndefined();
      expect(await appWindows()).toEqual([]);
    });
  },
);
