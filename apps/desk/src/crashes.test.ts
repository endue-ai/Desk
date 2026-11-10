// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_REPORTS, reportCrashes, showLastCrash } from "./crashes";

const REPORT = { schema: 1, kind: "webview", message: "TypeError: x is undefined", plugins: [] };

describe("crash reports from the shell's window (#322)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("an_uncaught_error_is_reported_once", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => null);
    const stop = reportCrashes(window, invoke);
    const error = new TypeError("x is undefined");
    for (let n = 0; n < 3; n++)
      window.dispatchEvent(new ErrorEvent("error", { error, message: error.message }));
    const rejection = new Event("unhandledrejection") as PromiseRejectionEvent;
    Object.defineProperty(rejection, "reason", { value: new Error("lost") });
    window.dispatchEvent(rejection);
    for (let n = 0; n < 10; n++)
      window.dispatchEvent(
        new ErrorEvent("error", { error: new Error(`other ${n}`), message: `other ${n}` }),
      );
    expect(invoke).toHaveBeenCalledTimes(MAX_REPORTS);
    expect(invoke.mock.calls[0]).toEqual([
      "desk_crash",
      { message: "TypeError: x is undefined", stack: expect.stringContaining("x is undefined") },
    ]);
    expect(invoke.mock.calls[1]?.[1]).toMatchObject({
      message: "Unhandled rejection: Error: lost",
    });
    stop();
  });

  it("a_muted_error_without_an_error_object_reports_its_message_not_null", async () => {
    const invoke = vi.fn(async (_command: string, _args?: Record<string, unknown>) => null);
    const stop = reportCrashes(window, invoke);
    // Chromium's muted cross-origin error: `error` is null, only the message is left.
    window.dispatchEvent(new ErrorEvent("error", { error: null, message: "Script error." }));
    expect(invoke.mock.calls).toEqual([["desk_crash", { message: "Script error.", stack: "" }]]);
    stop();
  });

  it("a_report_from_last_time_shows_one_notice", async () => {
    const invoke = vi.fn(async (command: string) =>
      command === "take_last_crash" ? REPORT : null,
    );
    expect(await showLastCrash(document.body, invoke, async () => {})).toBe(true);
    const cards = document.querySelectorAll(".crash-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.querySelector(".crash-title")?.textContent).toBe("Desk crashed last time.");
    const labels = [...document.querySelectorAll(".crash-actions button")].map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Show report", "Copy"]);
    expect(invoke).toHaveBeenCalledWith("take_last_crash");
  });

  it("show_report_reveals_it_and_copy_copies_it", async () => {
    const copy = vi.fn(async () => {});
    await showLastCrash(document.body, async () => REPORT, copy);
    const [show, copyButton] = [
      ...document.querySelectorAll<HTMLButtonElement>(".crash-actions button"),
    ];
    const report = document.querySelector<HTMLPreElement>(".crash-report");
    expect(report?.hidden).toBe(true);
    show?.click();
    expect(report?.hidden).toBe(false);
    expect(JSON.parse(report?.textContent ?? "")).toEqual(REPORT);
    copyButton?.click();
    await vi.waitFor(() => expect(copyButton?.textContent).toBe("Copied"));
    expect(copy).toHaveBeenCalledWith(JSON.stringify(REPORT, null, 2));
    document.querySelector<HTMLButtonElement>(".crash-close")?.click();
    expect(document.querySelector(".crash-card")).toBeNull();
  });

  it("no_report_no_notice", async () => {
    expect(
      await showLastCrash(
        document.body,
        async () => null,
        async () => {},
      ),
    ).toBe(false);
    expect(document.querySelector(".crash-card")).toBeNull();
  });
});
