// Local crash reports (#322). An uncaught error in the shell's window goes to the app's desk_crash
// command, which writes a redacted report under the data folder's crashes/: the spec's HOME, which
// the error's message names, is `~` there. The next start shows one card for it ("Desk crashed last
// time."), and the start after that shows none. browser.reloadSession() quits the app and launches it
// again with the same HOME (support/driver.ts). A kill lets nothing write: the next start finds the run
// was never marked quit in last-start.json, writes an `exit` report for it and shows its card (ADR XXXX).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { appData, shellReady } from "../support/desk";
import { appPid, HOME_VAR } from "../support/driver";

const home = () => {
  const value = process.env[HOME_VAR];
  if (!value) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  return value;
};
const crashes = () => join(appData(), "crashes");

/** The reports written so far, as text, oldest first. */
function reports(): string[] {
  try {
    return readdirSync(crashes())
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => readFileSync(join(crashes(), name), "utf8"));
  } catch {
    return [];
  }
}

describe("crash: a webview error writes a redacted report, and the next start shows it once", () => {
  it("an uncaught error in the shell writes a report without the HOME path", async () => {
    await shellReady();
    const secret = `${home()}/Notes/secret.md`;
    // The error event the engine fires at the window for an uncaught error in the shell's own script.
    // A script thrown from WebDriver's execute is not the page's own: Chromium mutes its error ("Script
    // error.", no error object), as it does for any script from another origin.
    await browser.execute((path: string) => {
      const error = new Error(`cannot read ${path}`);
      window.dispatchEvent(new ErrorEvent("error", { error, message: `Uncaught ${error}` }));
    }, secret);
    await browser.waitUntil(async () => reports().length === 1, {
      timeout: 10_000,
      timeoutMsg: "no crash report was written",
    });
    const [report] = reports();
    expect(report).toContain('"kind": "webview"');
    expect(report).toContain("~/Notes/secret.md");
    expect(report).not.toContain(home());
  });

  it("the next start shows one card with the report", async () => {
    await browser.reloadSession();
    await shellReady();
    const card = $(".crash-card");
    await expect(card).toBeDisplayed({ wait: 10_000 });
    await expect($(".crash-card .crash-title")).toHaveText("Desk crashed last time.");
    await expect($$(".crash-card")).toBeElementsArrayOfSize(1);
  });

  it("the start after that shows none", async () => {
    await browser.reloadSession();
    await shellReady();
    // The card would come right after the ready line; give it the time it takes.
    await browser.pause(2_000);
    await expect($(".crash-card")).not.toBeExisting();
  });

  it("a start after a kill shows a card for the run that ended without quitting", async () => {
    const pid = appPid();
    if (!pid) throw new Error("the running app's pid is not known");
    const before = reports().length;
    process.kill(pid, "SIGKILL");
    await browser.reloadSession();
    await shellReady();
    await expect($(".crash-card")).toBeDisplayed({ wait: 10_000 });
    const written = reports();
    expect(written).toHaveLength(before + 1);
    const newest = written.at(-1) ?? "";
    expect(newest).toContain('"kind": "exit"');
    expect(newest).toContain(`(process ${pid})`);
  });
});
