// A plugin from DESK_DEV_PLUGINS (e2e/fixtures/plugin-e2e-hello, id e2e.hello) is listed by the
// sidebar (endue.sidebar) and turned off and on there. e2e/fixtures/init-no-first-run.yaml holds the
// first run off, so no overlay covers the desk.
import { $, expect } from "@wdio/globals";
import { deskReady, inFrame, surface } from "../support/desk";

const HELLO = "e2e.hello";

/** The sidebar row's checkbox for e2e.hello (rows carry the name). Fresh each time: the list re-renders. */
const toggle = () => $("[data-testid=plugins]").$("label*=E2E Hello").$("input[type=checkbox]");

describe("plugins", () => {
  it("a plugin from DESK_DEV_PLUGINS is listed and can be turned off and on", async () => {
    await deskReady();
    await expect(surface(HELLO)).toExist();

    await inFrame("endue.sidebar", async () => {
      await expect(toggle()).toBeChecked();
      await toggle().click();
    });
    await expect(surface(HELLO)).not.toExist();

    await inFrame("endue.sidebar", async () => {
      await expect(toggle()).not.toBeChecked();
      await toggle().click();
      await expect(toggle()).toBeChecked();
    });
    await expect(surface(HELLO)).toExist();
    // Mounted again: its page loaded and its bridge answered.
    await inFrame(HELLO, () =>
      expect($("[data-testid=bridge]")).toHaveText(expect.stringContaining("bridge: ok")),
    );
  });
});
