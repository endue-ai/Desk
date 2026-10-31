// The packaged app on a fresh data folder mounts the desk shell: the system layer (profiles, desktops,
// the agent bar) and the mode layer over the runtime. desk_ready is reported on the shell's status line
// and on stdout, and the first run arrives over the shell as an overlay surface and can be skipped.
// init.yaml is specs/init/v0's template (e2e/fixtures/init.yaml, the Default profile); no brain is
// running, so the agent bar shows the directory offline, and Skip stops at sign-in before any brain
// call.
import { $, browser, expect } from "@wdio/globals";
import { appLog, inFrame, MODE, READY, SYSTEM, shellReady } from "../support/desk";

const ONBOARDING = "endue.onboarding";

describe("launch: the desk shell on a fresh data folder", () => {
  it("the app mounts the desk shell and reports desk_ready", async () => {
    await shellReady();
    // The system layer: the profile switcher, the desktop switcher and the agent bar.
    for (const part of [".modes", ".desktops", ".sidebar"]) {
      await expect($(`${SYSTEM} ${part}`)).toExist();
    }
    await expect($(`${MODE} footer.desk-status`)).toHaveElementProperty("textContent", READY);
    // commands/ready.rs prints the same line on the app's stdout once desk.ready resolved
    // (apps/desk/src/main.ts).
    await browser.waitUntil(async () => appLog().includes(READY), {
      timeout: 10_000,
      timeoutMsg: `the app's stdout has no "${READY}" line`,
    });
  });

  it("the first run arrives over the shell", async () => {
    // An overlay surface on the runtime inside the shell's mode layer, drawn over both layers.
    await expect($(`${MODE} [data-surface="${ONBOARDING}"].desk-surface--overlay`)).toExist({
      wait: 10_000,
    });
    await inFrame(ONBOARDING, () =>
      browser.waitUntil(async () => Boolean(await $("html").getAttribute("data-scene")), {
        timeout: 10_000,
        timeoutMsg: "the onboarding frame never set data-scene",
      }),
    );
  });

  it("Skip intro works over the shell", async () => {
    await inFrame(ONBOARDING, async () => {
      const skip = $("#skip button");
      await skip.waitForDisplayed();
      await expect(skip).toHaveText("Skip intro");
      await skip.click();
      await expect($("html")).toHaveAttribute("data-scene", "sign-in");
    });
  });
});
