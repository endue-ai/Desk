// The desk across a relaunch. A surface put away from the dock (endue.dock) stays away: the flag is in
// plugins.json. One opened and in use comes back focused: the desk.session record in store.json.
// browser.reloadSession() makes tauri-driver quit the app and launch it again with the same HOME; the
// spec polls those files before each relaunch instead of sleeping.
import { $, browser, expect } from "@wdio/globals";
import { deskReady, focusedSurface, inFrame, surface, waitForData } from "../support/desk";

const HELLO = "e2e.hello";
const tile = () => $(`button.tile[data-plugin="${HELLO}"]`);

type Plugins = { enabled?: Record<string, boolean> };
type Store = { desk?: { session?: { focused?: string | null } } };

describe("session", () => {
  it("a surface opened before quitting is back after a relaunch", async () => {
    await deskReady();
    await expect(surface(HELLO)).toExist();

    // Put it away from the dock.
    await inFrame("endue.dock", async () => {
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
    await deskReady();
    await inFrame("endue.dock", () => expect(tile()).toHaveAttribute("aria-pressed", "false"));
    await expect(surface(HELLO)).not.toExist();

    // Open it from the dock and put it in use (center surfaces open without the focus).
    await inFrame("endue.dock", () => tile().click());
    await expect(surface(HELLO)).toExist();
    await surface(HELLO).$(".desk-surface-title").click();
    await waitForData(
      "store.json",
      (value) => (value as Store | undefined)?.desk?.session?.focused === HELLO,
      `desk.session with focused: ${HELLO}`,
    );

    // Relaunch: it is back and focused.
    await browser.reloadSession();
    await deskReady();
    await expect(surface(HELLO)).toExist();
    await browser.waitUntil(async () => (await focusedSurface()) === HELLO, {
      timeoutMsg: `${HELLO} is not focused after the relaunch`,
    });
  });
});
