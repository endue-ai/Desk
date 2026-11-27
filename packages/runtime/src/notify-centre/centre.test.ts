// @vitest-environment jsdom
// The notification centre's panel (#307): the desk's notices grouped Today and Earlier, newest
// first, each with its plugin, time, title, body and actions; an action runs from it, a row is
// dismissed, all are cleared; do not disturb is in its header; and it reads as a list with a count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centreDesk, press } from "./fixtures";

const at = (day: number, hour: number, minute: number) =>
  vi.setSystemTime(new Date(2026, 10, day, hour, minute));
const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("the notification centre", () => {
  it("groups notices Today and Earlier, newest first", async () => {
    at(20, 17, 30);
    const d = await centreDesk();
    d.policy.notify({ caller: "desk", title: "Backed up", body: "12 files", level: "success" });
    d.notified("n1", "zsh — make", "done");
    at(21, 9, 5);
    d.policy.notify({
      caller: "desk",
      title: "The upload stopped",
      body: "The server is away.",
      level: "warning",
      actions: [
        { label: "Retry", command: "example.retry" },
        { label: "Show the log", command: "example.log" },
      ],
    });
    at(21, 9, 40);
    d.notified("n2", "zsh — test", "2 failed");
    await d.hub.commands.run("desk.notify.history");

    const groups = [...(d.panel()?.querySelectorAll('[role="list"]') ?? [])];
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Today", "Earlier"]);
    const titles = (group: Element) =>
      [...group.querySelectorAll('[role="listitem"]')].map((row) =>
        text(row.querySelector(".desk-notify-row-title")),
      );
    expect(titles(groups[0] as Element)).toEqual(["zsh — test", "The upload stopped"]);
    expect(titles(groups[1] as Element)).toEqual(["zsh — make", "Backed up"]);

    const [test, upload, make] = d.rows();
    // Each row: its plugin's name (plugin.list's, endue for the desk's own), its time, its words.
    expect(text(test?.querySelector(".desk-notify-plugin"))).toBe("Terminal");
    expect(text(test?.querySelector("time"))).toBe("09:40");
    expect(text(test?.querySelector(".desk-notify-row-body"))).toBe("2 failed");
    expect(text(upload?.querySelector(".desk-notify-plugin"))).toBe("endue");
    expect(text(upload?.querySelector("time"))).toBe("09:05");
    expect(text(upload?.querySelector(".desk-notify-row-body"))).toBe("The server is away.");
    expect(
      [...(upload?.querySelectorAll(".desk-notify-action") ?? [])].map((b) => text(b)),
    ).toEqual(["Retry", "Show the log"]);
    // An earlier day says which day.
    expect(text(make?.querySelector("time"))).toBe("Nov 20, 17:30");
    expect(make?.querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(2026, 10, 20, 17, 30).toISOString(),
    );
  });

  it("an action runs from the history, and a row can be dismissed", async () => {
    at(21, 9, 0);
    const d = await centreDesk();
    let retried = 0;
    d.hub.commands.define("example.retry", {
      title: "Retry the upload",
      owner: "desk",
      run: () => {
        retried++;
        if (retried > 1) throw new Error("the server is away");
      },
    });
    await d.hub.commands.settled();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    d.policy.notify({ caller: "desk", title: "Saved", level: "info" });
    d.policy.notify({
      caller: "desk",
      title: "The upload stopped",
      level: "warning",
      actions: [{ label: "Retry", command: "example.retry" }],
    });
    d.bell()?.click();
    const upload = () => d.rows().find((row) => row.textContent?.includes("The upload stopped"));

    d.button(upload() as Element, "Retry")?.click();
    await vi.waitFor(() => expect(retried).toBe(1));
    // The status line no longer shows the notice acted on; the history keeps it.
    expect(d.policy.notifications.current()?.title).not.toBe("The upload stopped");
    expect(d.rows()).toHaveLength(2);

    // A failure says why (gesture.ts): one error notice, in the panel too.
    d.button(upload() as Element, "Retry")?.click();
    await vi.waitFor(() => expect(d.rows()).toHaveLength(3));
    expect(text(d.rows()[0]?.querySelector(".desk-notify-row-title"))).toBe(
      "Retry the upload failed",
    );
    expect(text(d.rows()[0]?.querySelector(".desk-notify-row-body"))).toBe("the server is away");
    expect(log).toHaveBeenCalledOnce();

    // Dismiss takes out only its row.
    const saved = d.rows().find((row) => row.textContent?.includes("Saved"));
    d.button(saved as Element, "Dismiss")?.click();
    expect(d.rows().map((row) => text(row.querySelector(".desk-notify-row-title")))).toEqual([
      "Retry the upload failed",
      "The upload stopped",
    ]);
    expect(d.policy.notifications.history().map((n) => n.title)).not.toContain("Saved");

    // Clear all empties it, and the panel says so.
    const clear = d.button(d.panel() as Element, "Clear all");
    clear?.click();
    expect(d.rows()).toHaveLength(0);
    expect(d.policy.notifications.history()).toEqual([]);
    expect(text(d.panel()?.querySelector(".desk-notify-empty"))).toContain("No notifications");
    expect(clear?.disabled).toBe(true);
  });

  it("the header holds the do not disturb switch", async () => {
    const d = await centreDesk();
    await d.hub.commands.run("desk.notify.history");
    const dnd = d.panel()?.querySelector<HTMLButtonElement>('header [role="switch"]');
    expect(text(dnd)).toBe("Do not disturb");
    expect(dnd?.getAttribute("aria-checked")).toBe("false");
    dnd?.click();
    expect(d.hub.settings.get("desk.notify.dnd")).toBe(true);
    expect(d.policy.notifications.settings.dnd).toBe(true);
    expect(dnd?.getAttribute("aria-checked")).toBe("true");
    // It follows the setting however it changes: here the command's key.
    await d.hub.commands.run("desk.notify.dnd");
    expect(d.hub.settings.get("desk.notify.dnd")).toBe(false);
    expect(dnd?.getAttribute("aria-checked")).toBe("false");
  });

  it("reads as a list with a live count", async () => {
    const d = await centreDesk();
    for (const title of ["One", "Two", "Three"]) d.policy.notify({ caller: "desk", title });
    const bell = d.bell() as HTMLButtonElement;
    bell.focus();
    bell.click();

    const panel = d.panel() as HTMLElement;
    expect(panel.getAttribute("aria-label")).toBe("Notifications");
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    const lists = panel.querySelectorAll('[role="list"]');
    expect(lists).toHaveLength(1);
    expect(lists[0]?.querySelectorAll(':scope > [role="listitem"]')).toHaveLength(3);
    const live = panel.querySelector('[aria-live="polite"]');
    expect(text(live)).toBe("3 notifications");

    // The arrows walk the rows, the first holding the focus once it opens.
    const [three, two, one] = d.rows();
    expect(document.activeElement).toBe(three);
    press(three as Element, "ArrowDown");
    expect(document.activeElement).toBe(two);
    press(two as Element, "ArrowDown");
    press(one as Element, "ArrowDown");
    expect(document.activeElement).toBe(one);
    press(one as Element, "ArrowUp");
    expect(document.activeElement).toBe(two);
    press(two as Element, "Home");
    expect(document.activeElement).toBe(three);
    press(three as Element, "End");
    expect(document.activeElement).toBe(one);

    // A dismissed row gives the focus to the next, and the count says so.
    d.button(two as Element, "Dismiss")?.click();
    expect(text(live)).toBe("2 notifications");
    expect(document.activeElement).toBe(d.rows()[1]);

    // Escape closes it and gives the focus back to the control; the desk's quit key does not run.
    const quit = press(document.activeElement as Element, "Escape");
    expect(quit.defaultPrevented).toBe(true);
    expect(d.panel()).toBeNull();
    expect(document.activeElement).toBe(bell);
    expect(bell.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes on a press outside it, and says it is empty when it is", async () => {
    const d = await centreDesk();
    await d.hub.commands.run("desk.notify.history");
    expect(text(d.panel()?.querySelector('[aria-live="polite"]'))).toBe("No notifications");
    d.panel()?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(d.panel()).not.toBeNull();
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(d.panel()).toBeNull();
  });
});
