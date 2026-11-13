// A plugin from DESK_DEV_PLUGINS (e2e/fixtures/plugin-e2e-hello, id e2e.hello) is listed by the Plugins
// list (endue.sidebar) and turned off and on there, under the desk shell. The shell has no plugin list
// of its own (its drawer holds its windows, dropped files and Eris's recent screens; ADR 0028 keeps the
// list in plugins/sidebar), so the spec drives endue.sidebar in its normal shell window (ADR 0083).
// That needs the Default profile, which turns
// nothing off: e2e/fixtures/init-no-first-run.yaml keeps it and holds the first run off, so no overlay
// covers the shell. plugins/shell's sample profiles turn endue.sidebar, endue.dock and endue.toolbar
// off; e2e.hello still mounts there, but nothing on the shell lists it, so no spec runs under them.
//
// The checkbox is reached and toggled from the keyboard, the way a keyboard user does it: the desk's
// focus cycling (Control+Tab, desk.display.focus-next) to the list's surface, Tab through the list in
// its frame, then Space. Keyboard navigation reaches rows scrolled out of a compact window. The list
// is an off-screen browser of its own (#52): Tab and Space go to its page, as WebDriver sent them
// into its frame on Stage 1's windowed desk.
// Not Element Send Keys:
// WebKitWebDriver answers "element not interactable" for the checkbox, since the focus it moves by
// script does not land inside the plugin's cross-origin frame. The drawer button staying closed shows
// that the keys reached the list, not the shell.
import { $, browser, expect } from "@wdio/globals";
import {
  drawerButton,
  expectSurface,
  focusedSurface,
  inFrame,
  shellReady,
  waitForData,
} from "../support/desk";
import { deskNow } from "../support/windows";

const HELLO = "e2e.hello";
const SIDEBAR = "endue.sidebar";

/** The list's checkbox for e2e.hello (rows carry the name). Fresh each time: the list re-renders. */
const toggle = () => $("[data-testid=plugins]").$("label*=E2E Hello").$("input[type=checkbox]");

type Plugins = { enabled?: Record<string, boolean> };

/** Move the keyboard focus to the Plugins list's surface with the desk's focus cycling. */
async function focusList(): Promise<void> {
  for (let presses = 0; presses < 16; presses++) {
    const before = await focusedSurface();
    if (before === SIDEBAR) return;
    await browser.keys(["Control", "Tab"]);
    await browser.waitUntil(async () => (await focusedSurface()) !== before, {
      timeout: 5_000,
      timeoutMsg: `Control+Tab did not move the focus on from ${before}`,
    });
  }
  throw new Error(`Control+Tab never brought the focus to ${SIDEBAR}`);
}

/** Tab from the list's surface through its rows until e2e.hello's checkbox holds the focus. */
async function tabToHello(): Promise<void> {
  await focusList();
  await inFrame(SIDEBAR, async () => {
    for (let presses = 0; presses < 60 && !(await toggle().isFocused()); presses++) {
      await browser.keys("Tab");
    }
    await expect(toggle()).toBeFocused();
  });
}

describe("plugins: the Plugins list in a normal window (endue.sidebar, Default profile)", () => {
  it("a plugin from DESK_DEV_PLUGINS is listed under the shell and turned off and on from the keyboard", async () => {
    await shellReady();
    await expectSurface(HELLO);
    const sidebar = (await deskNow()).windows.find((w) =>
      w.panes.some((p) => p.plugin === SIDEBAR),
    );
    expect(sidebar?.state).toBe("normal");
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");
    await inFrame(SIDEBAR, () => expect(toggle()).toBeChecked());

    // Off: Space on the checked box.
    await tabToHello();
    await inFrame(SIDEBAR, () => browser.keys("Space"));
    await inFrame(SIDEBAR, () => expect(toggle()).not.toBeChecked());
    await expectSurface(HELLO, false);
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");
    await waitForData(
      "plugins.json",
      (value) => (value as Plugins | undefined)?.enabled?.[HELLO] === false,
      `enabled["${HELLO}"] === false`,
    );

    // On again: the list re-rendered, so Tab to the new row's box and press Space.
    await tabToHello();
    await inFrame(SIDEBAR, () => browser.keys("Space"));
    await inFrame(SIDEBAR, () => expect(toggle()).toBeChecked());
    await expectSurface(HELLO);
    // Mounted again: its page loaded and its bridge answered.
    await inFrame(HELLO, () =>
      expect($("[data-testid=bridge]")).toHaveText(expect.stringContaining("bridge: ok")),
    );
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");
  });
});
