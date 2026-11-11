// A wrong line in init.yaml never keeps the desk from starting (ADR 0080). The app starts on
// e2e/fixtures/init-bad-values.yaml, whose desk.theme.scheme (purple, not one of its choices) and
// desk.notify.dnd ("yes", not a boolean) fail their settings: it reaches the ready line, the theme in
// force is desk.theme.scheme's default (dark), and the core names both values with their init.yaml
// lines on the app's log (apps/desk prints Core::settings_problems at start) and in one notice on the
// desk (ADR XXXX). The status line shows that notice for its 8 s right after the ready line, before
// shellReady sees the ready line there, so the spec reads it from the notification history the session
// keeps in store.json (desk.session's `notices`).
import { $, browser, expect } from "@wdio/globals";
import { appLog, dataFile, READY, shellReady, waitForData } from "../support/desk";

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

  it("the desk shows one notice naming both lines", async () => {
    type Notice = { caller?: string; title?: string; body?: string; level?: string };
    type Store = { desk?: { session?: { notices?: Notice[] } } };
    const told = (store: unknown) =>
      ((store as Store | undefined)?.desk?.session?.notices ?? []).filter(
        (n) => n.title === "2 setting values are not used",
      );
    await waitForData("store.json", (store) => told(store).length > 0, "the settings notice");
    const [notice, ...again] = told(dataFile("store.json"));
    expect(again).toHaveLength(0);
    expect(notice.caller).toBe("core");
    expect(notice.level).toBe("warning");
    for (const [name, line] of BAD) {
      expect(notice.body).toContain(`init-bad-values.yaml:${line}: ${name}: `);
    }
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
