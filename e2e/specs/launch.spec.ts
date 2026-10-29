// The packaged app on a fresh data folder: the core answers, desk_ready is reported on the status line
// and on stdout, and the first run arrives and can be skipped. init.yaml is specs/init/v0's template
// (e2e/fixtures/init.yaml); no brain is running, and Skip stops at sign-in before any brain call.
import { $, browser, expect } from "@wdio/globals";
import { appLog, deskReady, inFrame, READY } from "../support/desk";

describe("launch", () => {
  it("the app starts and desk_ready is reported", async () => {
    await deskReady();
    // commands/ready.rs prints the same line on the app's stdout.
    await browser.waitUntil(async () => appLog().includes(READY), {
      timeout: 10_000,
      timeoutMsg: `the app's stdout has no "${READY}" line`,
    });
  });

  it("the first run's arrival renders", async () => {
    await $('[data-surface="endue.onboarding"] iframe').waitForExist({ timeout: 10_000 });
    await inFrame("endue.onboarding", () =>
      browser.waitUntil(async () => Boolean(await $("html").getAttribute("data-scene")), {
        timeout: 10_000,
        timeoutMsg: "the onboarding frame never set data-scene",
      }),
    );
  });

  it("Skip intro works", async () => {
    await inFrame("endue.onboarding", async () => {
      const skip = $("#skip button");
      await skip.waitForDisplayed();
      await expect(skip).toHaveText("Skip intro");
      await skip.click();
      await expect($("html")).toHaveAttribute("data-scene", "sign-in");
    });
  });
});
