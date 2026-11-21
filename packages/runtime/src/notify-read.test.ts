// What the notification centre reads of the history (#307): how many notices arrived since it was
// last opened, held ones included; one taken out of it, or all of them; and a word for each change.
import { describe, expect, it } from "vitest";
import { ManualClock } from "./clock";
import { DEFAULT_NOTIFY, type Notice, Notifications } from "./notify";

function centre() {
  const clock = new ManualClock();
  const shown: Array<Notice | null> = [];
  const notifications = new Notifications(clock, (notice) => shown.push(notice));
  let changes = 0;
  notifications.onChange(() => changes++);
  return { clock, shown, notifications, changes: () => changes };
}

describe("Notifications: read and unread", () => {
  it("counts unread notices and opening marks them read", () => {
    const { notifications, changes, shown } = centre();
    expect(notifications.unread()).toBe(0);
    notifications.push({ caller: "desk", title: "Saved" });
    notifications.push({ caller: "example.build", title: "Built", level: "success" });
    expect(notifications.unread()).toBe(2);
    expect(changes()).toBe(2);

    // Do not disturb holds one back: it is in the history, and unread all the same.
    notifications.configure({ ...DEFAULT_NOTIFY, dnd: true });
    notifications.push({ caller: "example.chat", title: "New message" });
    expect(notifications.history()[0]?.held).toBe(true);
    expect(notifications.unread()).toBe(3);

    notifications.markRead();
    expect(notifications.unread()).toBe(0);
    expect(changes()).toBe(4);
    notifications.configure(DEFAULT_NOTIFY);
    // Ending do not disturb says how many arrived: that line is new, so it is unread.
    expect(notifications.unread()).toBe(1);

    // One taken out of the history: gone from it, from the count, and from the status line.
    const error = notifications.push({ caller: "desk", title: "Disk full", level: "error" });
    expect(notifications.current()).toBe(error);
    expect(notifications.unread()).toBe(2);
    const before = changes();
    notifications.remove(error.id);
    expect(notifications.history().map((n) => n.id)).not.toContain(error.id);
    expect(notifications.unread()).toBe(1);
    expect(notifications.current()).toBeNull();
    expect(shown.at(-1)).toBeNull();
    expect(changes()).toBe(before + 1);

    notifications.clear();
    expect(notifications.history()).toEqual([]);
    expect(notifications.unread()).toBe(0);
    expect(changes()).toBe(before + 2);
  });

  it("taking out a notice that stays shows the one it covered, and one it covered is not shown again", () => {
    const { notifications } = centre();
    const first = notifications.push({ caller: "desk", title: "Shell failed", level: "error" });
    const second = notifications.push({ caller: "desk", title: "Disk full", level: "error" });
    expect(notifications.current()).toBe(second);
    notifications.remove(second.id);
    expect(notifications.current()).toBe(first);

    const third = notifications.push({ caller: "desk", title: "Upload stopped", level: "error" });
    notifications.remove(first.id);
    notifications.dismiss();
    expect(notifications.history()).toEqual([third]);
    // The covered one left the history: it does not come back to the status line.
    expect(notifications.current()).toBeNull();
  });

  it("knows when each notice arrived on the wall clock, and keeps it across a restore", () => {
    const clock = new ManualClock();
    const wall = Date.parse("2026-11-21T09:30:00.000Z");
    const notifications = new Notifications(
      clock,
      () => {},
      () => wall,
    );
    const notice = notifications.push({ caller: "desk", title: "Saved" });
    expect(notice.time).toBe(wall);

    const later = new Notifications(clock, () => {});
    later.restore([notice]);
    expect(later.history()[0]?.time).toBe(wall);
    // A history kept from an earlier session was read there.
    expect(later.unread()).toBe(0);
  });
});
