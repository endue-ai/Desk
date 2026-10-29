import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { DEFAULT_NOTIFY, type Notice, Notifications, noticeText } from "./notify";

function center() {
  const clock = new ManualClock();
  const shown: Array<string | null> = [];
  const notifications = new Notifications(clock, (n: Notice | null) =>
    shown.push(n ? noticeText(n) : null),
  );
  return { clock, shown, notifications };
}

describe("Notifications", () => {
  it("shows a notice for as long as its level says, then clears", () => {
    const { clock, shown, notifications } = center();
    notifications.push({
      caller: "example.build",
      title: "Built",
      body: "All green.",
      level: "success",
    });
    expect(shown).toEqual(["Built — All green."]);
    clock.advance(3999);
    expect(notifications.current()?.title).toBe("Built");
    clock.advance(1);
    expect(notifications.current()).toBeNull();
    expect(shown.at(-1)).toBeNull();
  });

  it("keeps an error until it is dismissed", () => {
    const { clock, notifications } = center();
    notifications.push({ caller: "desk", title: "Disk full", level: "error" });
    clock.advance(60_000);
    expect(notifications.current()?.title).toBe("Disk full");
    notifications.dismiss();
    expect(notifications.current()).toBeNull();
  });

  it("holds back what do-not-disturb does not allow, and says how many when it ends", () => {
    const { notifications } = center();
    notifications.configure({ ...DEFAULT_NOTIFY, dnd: true });
    notifications.push({ caller: "example.chat", title: "New message" });
    notifications.push({ caller: "example.chat", title: "Another" });
    expect(notifications.current()).toBeNull();
    notifications.push({ caller: "desk", title: "Disk full", level: "error" });
    expect(notifications.current()?.title).toBe("Disk full");
    notifications.configure({ ...DEFAULT_NOTIFY, dnd: false });
    expect(notifications.current()?.title).toBe("2 notifications while you were away");
    expect(notifications.history().map((n) => [n.title, n.held])).toEqual([
      ["2 notifications while you were away", false],
      ["Disk full", false],
      ["Another", true],
      ["New message", true],
    ]);
  });

  it("keeps only as much history as the setting says, newest first", () => {
    const { notifications } = center();
    notifications.configure({ ...DEFAULT_NOTIFY, history: 2 });
    for (const title of ["one", "two", "three"]) notifications.push({ caller: "desk", title });
    expect(notifications.history().map((n) => n.title)).toEqual(["three", "two"]);
    notifications.clear();
    expect(notifications.history()).toEqual([]);
  });
});
