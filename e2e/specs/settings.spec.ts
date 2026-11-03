// A wrong line in init.yaml never keeps the desk from starting (ADR 0080). The app starts on
// e2e/fixtures/init-bad-values.yaml, whose desk.theme.scheme (purple, not one of its choices) and
// desk.notify.dnd ("yes", not a boolean) fail their settings: it reaches the ready line, the theme in
// force is desk.theme.scheme's default (dark), and the core names both values with their init.yaml
// lines on the app's log (apps/desk prints Core::settings_problems at start).
import { $, browser, expect } from "@wdio/globals";
import { appLog, READY, shellReady } from "../support/desk";

/** The fixture's lines that hold the two bad values. */
const BAD = [
  ["desk.theme.scheme", 12],
  ["desk.notify.dnd", 13],
] as const;

describe("settings: values that fail their settings fall back to the defaults", () => {
  it("the desk starts and reports desk_ready", async () => {
    await shellReady();
    await browser.waitUntil(async () => appLog().includes(READY), {
      timeout: 10_000,
      timeoutMsg: `the app's stdout has no "${READY}" line`,
    });
  });

  it("the default scheme is in force", async () => {
    // Under the shell the theme's root is the document's (packages/runtime/src/shell/Desk.ts).
    await expect($("html")).toHaveAttribute("data-scheme", "dark");
  });

  it("the log names both values with their init.yaml lines", async () => {
    for (const [name, line] of BAD) {
      const named = `init-bad-values.yaml:${line}: ${name}: `;
      await browser.waitUntil(async () => appLog().some((entry) => entry.includes(named)), {
        timeout: 10_000,
        timeoutMsg: `the app's log never names ${name} on line ${line}`,
      });
    }
  });
});
