// The desk shell across a relaunch. browser.reloadSession() makes tauri-driver quit the app and launch
// it again with the same HOME; the spec polls the data files before each relaunch instead of sleeping.
//
// A surface put away from the dock stays away: the flag is in plugins.json. One opened and in use
// comes back focused: the desk.session record in store.json. The dock is endue.dock, the runtime's
// bottom edge inside the shell's mode layer, on under the Default profile that
// e2e/fixtures/init-no-first-run.yaml keeps; the shell's own drawer cannot put a plugin surface away or
// bring one back, so the case stays on the dock. plugins/shell's sample profiles turn the dock off, so
// no spec runs under them.
//
// The shell's own part of desk.session (`parts.shell`) is checked with the desktop switcher in the
// system layer. A shell window put away in the drawer and raised across a reload stays with the
// runtime e2e (packages/runtime/e2e/shell*.spec.ts on the stub): no shell window is open here.
import { $, browser, expect } from "@wdio/globals";
import { focusedSurface, inFrame, SYSTEM, shellReady, surface, waitForData } from "../support/desk";

const HELLO = "e2e.hello";
const DOCK = "endue.dock";
const tile = () => $(`button.tile[data-plugin="${HELLO}"]`);
const desktop = (n: number) => $(`${SYSTEM} [data-desktop="${n}"]`);

type Plugins = { enabled?: Record<string, boolean> };
type Store = {
  desk?: { session?: { focused?: string | null; parts?: { shell?: { desktop?: number } } } };
};
const session = (value: unknown) => (value as Store | undefined)?.desk?.session;

describe("session: the shell across a relaunch", () => {
  it("a surface put away from the dock under the shell stays away, and one in use comes back focused", async () => {
    await shellReady();
    await expect(surface(HELLO)).toExist();

    // Put it away from the dock.
    await inFrame(DOCK, async () => {
      await expect(tile()).toHaveAttribute("aria-pressed", "true");
      await tile().click();
      await expect(tile()).toHaveAttribute("aria-pressed", "false");
    });
    await expect(surface(HELLO)).not.toExist();
    await waitForData(
      "plugins.json",
      (value) => (value as Plugins | undefined)?.enabled?.[HELLO] === false,
      `${HELLO} turned off`,
    );

    // Relaunch: it is still away (the dock lists it, not pressed).
    await browser.reloadSession();
    await shellReady();
    await inFrame(DOCK, () => expect(tile()).toHaveAttribute("aria-pressed", "false"));
    await expect(surface(HELLO)).not.toExist();

    // Open it from the dock and put it in use (center surfaces open without the focus).
    await inFrame(DOCK, () => tile().click());
    await expect(surface(HELLO)).toExist();
    await surface(HELLO).$(".desk-surface-title").click();
    await waitForData(
      "store.json",
      (value) => session(value)?.focused === HELLO,
      `desk.session with focused: ${HELLO}`,
    );

    // Relaunch: it is back and focused.
    await browser.reloadSession();
    await shellReady();
    await expect(surface(HELLO)).toExist();
    await browser.waitUntil(async () => (await focusedSurface()) === HELLO, {
      timeoutMsg: `${HELLO} is not focused after the relaunch`,
    });
  });

  it("the desktop picked in the shell's desktop switcher comes back", async () => {
    await shellReady();
    await desktop(2).click();
    await expect(desktop(2)).toHaveAttribute("aria-pressed", "true");
    await expect(desktop(1)).toHaveAttribute("aria-pressed", "false");
    await waitForData(
      "store.json",
      (value) => session(value)?.parts?.shell?.desktop === 2,
      "desk.session with parts.shell.desktop: 2",
    );

    // Relaunch: the shell is back on desktop 2.
    await browser.reloadSession();
    await shellReady();
    await expect(desktop(2)).toHaveAttribute("aria-pressed", "true");
  });
});
