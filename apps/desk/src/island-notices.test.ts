// Notices on the island (ADR 0204) under desk.notify's rules: how long each level shows, what
// do-not-disturb holds back and lets through, the line for what it held, nothing while the island is
// hidden (the desk in front says it), and the rules from the shell, defaults where they are missing.
import type { BridgeEvent, NotifyLevel } from "@endue-ai/bridge";
import { ManualClock } from "@endue-ai/runtime";
import { describe, expect, it, vi } from "vitest";
import { islandNotices, rulesOf } from "./island-notices";

const notified = (id: string, level: NotifyLevel, title = `Notice ${id}`): BridgeEvent => ({
  event: "ui.notified",
  data: { notificationId: id, caller: "endue.notes", title, level },
});

const RULES = {
  durations: { info: 4000, success: 4000, warning: 8000, error: 0 },
  dnd: false,
  dndAllows: ["error"],
  history: 200,
};

describe("the island's notices", () => {
  const make = (hidden = false) => {
    const clock = new ManualClock();
    const changed = vi.fn();
    const notices = islandNotices(clock, () => hidden, changed);
    notices.configure(RULES);
    return { clock, changed, notices };
  };

  it("shows a notice for as long as its level says, and an error until it is seen", () => {
    const { clock, notices, changed } = make();
    notices.hear(notified("n-1", "info"));
    expect(notices.current()?.title).toBe("Notice n-1");
    expect(changed).toHaveBeenCalled();
    clock.advance(4001);
    expect(notices.current()).toBeNull();
    notices.hear(notified("n-2", "error"));
    clock.advance(60_000);
    expect(notices.current()?.title).toBe("Notice n-2");
    notices.seen();
    expect(notices.current()).toBeNull();
    expect(notices.recent().map((n) => n.id)).toEqual(["n-2", "n-1"]);
  });

  it("holds back under do-not-disturb what it does not allow, and says so when it ends", () => {
    const { notices } = make();
    notices.configure({ ...RULES, dnd: true });
    notices.hear(notified("n-1", "info"));
    notices.hear(notified("n-2", "warning"));
    expect(notices.current()).toBeNull();
    expect(notices.recent()).toEqual([]);
    notices.hear(notified("n-3", "error"));
    expect(notices.current()?.id).toBe("n-3");
    notices.seen();
    notices.configure({ ...RULES, dnd: false });
    expect(notices.current()?.title).toBe("2 notifications while you were away");
  });

  it("hears nothing while the island is hidden: the desk in front says it", () => {
    const { notices } = make(true);
    notices.hear(notified("n-1", "error"));
    expect(notices.current()).toBeNull();
    expect(notices.recent()).toEqual([]);
  });

  it("takes the shell's rules, each the default when it is missing or not well formed", () => {
    expect(rulesOf(undefined)).toEqual(RULES);
    expect(
      rulesOf({ durations: { info: 1500, warning: "long" }, dnd: "yes", dndAllows: ["warning"] }),
    ).toEqual({
      durations: { info: 1500, success: 4000, warning: 8000, error: 0 },
      dnd: false,
      dndAllows: ["warning"],
      history: 200,
    });
  });
});
