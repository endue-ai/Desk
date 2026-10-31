// A plugin from DESK_DEV_PLUGINS (e2e/fixtures/plugin-e2e-hello, id e2e.hello) is listed by the Plugins
// list (endue.sidebar) and turned off and on there, under the desk shell. The shell has no plugin list
// of its own (its drawer holds its windows, dropped files and Eris's recent screens; ADR 0028 keeps the
// list in plugins/sidebar), so the spec drives endue.sidebar where the shell shows it: a surface on the
// runtime's left edge inside the shell's mode layer. That needs the Default profile, which turns
// nothing off: e2e/fixtures/init-no-first-run.yaml keeps it and holds the first run off, so no overlay
// covers the shell. plugins/shell's sample profiles turn endue.sidebar, endue.dock and endue.toolbar
// off; e2e.hello still mounts there, but nothing on the shell lists it, so no spec runs under them.
//
// The checkbox is toggled from the keyboard (Element Send Keys of a space), the way a keyboard user
// reaches it, not with the pointer: the E2E Hello row is the last of the list, at the bottom of the left
// edge, and the shell's drawer button (`.drawer-button`, at --z-float) is drawn over it, so a WebDriver
// click there opens the drawer and the checkbox never changes (#131). The drawer button staying closed
// shows that the keys reached the list, not the shell.
import { $, expect } from "@wdio/globals";
import { drawerButton, inFrame, MODE, shellReady, surface, waitForData } from "../support/desk";

const HELLO = "e2e.hello";
const SIDEBAR = "endue.sidebar";
/** WebDriver's Space key. */
const SPACE = "";

/** The list's checkbox for e2e.hello (rows carry the name). Fresh each time: the list re-renders. */
const toggle = () => $("[data-testid=plugins]").$("label*=E2E Hello").$("input[type=checkbox]");

type Plugins = { enabled?: Record<string, boolean> };

describe("plugins: the Plugins list on the shell's left edge (endue.sidebar, Default profile)", () => {
  it("a plugin from DESK_DEV_PLUGINS is listed under the shell and turned off and on from the keyboard", async () => {
    await shellReady();
    await expect(surface(HELLO)).toExist();
    await expect($(`${MODE} .desk-edge--left [data-surface="${SIDEBAR}"]`)).toExist();
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");

    // Off: Space on the checked box.
    await inFrame(SIDEBAR, async () => {
      await expect(toggle()).toBeChecked();
      await toggle().addValue(SPACE);
      await expect(toggle()).not.toBeChecked();
    });
    await expect(surface(HELLO)).not.toExist();
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");
    await waitForData(
      "plugins.json",
      (value) => (value as Plugins | undefined)?.enabled?.[HELLO] === false,
      `enabled["${HELLO}"] === false`,
    );

    // On again: Space on the new row's box.
    await inFrame(SIDEBAR, async () => {
      await expect(toggle()).not.toBeChecked();
      await toggle().addValue(SPACE);
      await expect(toggle()).toBeChecked();
    });
    await expect(surface(HELLO)).toExist();
    // Mounted again: its page loaded and its bridge answered.
    await inFrame(HELLO, () =>
      expect($("[data-testid=bridge]")).toHaveText(expect.stringContaining("bridge: ok")),
    );
    await expect(drawerButton()).toHaveAttribute("aria-expanded", "false");
  });
});
