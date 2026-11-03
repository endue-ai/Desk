// Safe mode after a crash loop (ADR 0061), counted by the app across real relaunches. The app writes
// last-start.json at start ({ phase: "starting", failed }) and marks it ready at the ready line. A start
// killed before ready leaves "starting" behind; the spec leaves it so by writing the record back as the
// app wrote it at start, then relaunches (browser.reloadSession() quits the app and starts it again
// with the same HOME). Two such starts in a row make the third one safe mode: only the desk.* policy
// plugins run, the system layer shows the badge, and a notice names the plugins that were on.
import { $, browser, expect } from "@wdio/globals";
import { appLog, dataFile, MODE, SYSTEM, surface, writeDataFile } from "../support/desk";

const HELLO = "e2e.hello";
const BADGE = `${SYSTEM} .safe-badge`;

type LastStart = { at?: string; pid?: number; phase?: string; failed?: number };
type Plugins = { enabled?: Record<string, boolean> };
const last = () => dataFile("last-start.json") as LastStart | undefined;

/** The shell is in and this start reached its ready line (the status line may carry a notice). */
async function started(): Promise<void> {
  await expect($(SYSTEM)).toExist({ wait: 30_000 });
  await browser.waitUntil(async () => last()?.phase === "ready", {
    timeout: 30_000,
    timeoutMsg: "last-start.json never said ready",
  });
}

/** Leave the record as a start that died before its ready line would have. */
function neverReady(): void {
  writeDataFile("last-start.json", { ...last(), phase: "starting" });
}

describe("safe mode: a crash loop counted across relaunches", () => {
  it("two starts in a row that never reached ready make the third start safe mode", async () => {
    await started();
    expect(last()?.failed).toBe(0);
    await expect(surface(HELLO)).toExist();
    const flags = JSON.stringify(dataFile("plugins.json") ?? null);

    neverReady();
    await browser.reloadSession();
    await started();
    expect(last()?.failed).toBe(1);
    await expect($(BADGE)).not.toExist();
    await expect(surface(HELLO)).toExist();

    neverReady();
    await browser.reloadSession();
    await started();
    expect(last()?.failed).toBe(2);
    await expect($(BADGE)).toBeDisplayed();
    await expect($(`${BADGE} [data-key="start-normally"]`)).toBeDisplayed();
    await expect(surface(HELLO)).not.toExist();
    // The notice names the plugins that were on; the status line may clip it, so read its text.
    await expect($(`${MODE} footer.desk-status`)).toHaveElementProperty(
      "textContent",
      expect.stringContaining(HELLO),
    );
    expect(JSON.stringify(dataFile("plugins.json") ?? null)).toBe(flags);
    expect((dataFile("plugins.json") as Plugins | undefined)?.enabled?.[HELLO]).not.toBe(false);
    expect(appLog().some((line) => line.includes("safe mode (CrashLoop)"))).toBe(true);
  });

  it("the start after a safe start that reached ready is normal again", async () => {
    await browser.reloadSession();
    await started();
    expect(last()?.failed).toBe(0);
    await expect($(BADGE)).not.toExist();
    await expect(surface(HELLO)).toExist();
  });
});
