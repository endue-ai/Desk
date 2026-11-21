// @vitest-environment jsdom
// The notification centre's control (#307): right after the status line, it shows how many notices
// arrived since the panel was last open, and pressing it opens the panel, which marks them read.
import { afterEach, describe, expect, it } from "vitest";
import { centreDesk } from "./fixtures";

afterEach(() => document.body.replaceChildren());

describe("the notification centre's control", () => {
  it("the control shows the unread count and opening the panel marks them read", async () => {
    const d = await centreDesk();
    const bell = d.bell() as HTMLButtonElement;
    expect(d.line.nextElementSibling).toBe(bell);
    expect(bell.type).toBe("button");
    expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
    const count = bell.querySelector<HTMLElement>(".desk-notify-count");
    // Nothing unread: no count, and the label says only what it is.
    expect(count?.hidden).toBe(true);
    expect(bell.getAttribute("aria-label")).toBe("Notifications");

    d.policy.notify({ caller: "desk", title: "Saved", level: "info" });
    d.notified("n1", "zsh — make", "done");
    expect(count?.hidden).toBe(false);
    expect(count?.textContent).toBe("2");
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 2 unread");

    bell.click();
    expect(d.panel()).not.toBeNull();
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    expect(d.policy.notifications.unread()).toBe(0);
    expect(count?.hidden).toBe(true);
    expect(bell.getAttribute("aria-label")).toBe("Notifications");

    // What arrives while it is open is seen there.
    d.policy.notify({ caller: "desk", title: "Built", level: "success" });
    expect(d.rows()).toHaveLength(3);
    expect(count?.hidden).toBe(true);

    bell.click();
    expect(d.panel()).toBeNull();
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    d.policy.notify({ caller: "desk", title: "Synced", level: "info" });
    expect(count?.textContent).toBe("1");
    expect(bell.getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });

  it("speaks the desk's language", async () => {
    const d = await centreDesk();
    d.ctx.language = () => "ko";
    d.policy.notify({ caller: "desk", title: "저장됨", level: "info" });
    expect(d.bell()?.getAttribute("aria-label")).toBe("알림, 읽지 않은 알림 1개");
    d.bell()?.click();
    expect(d.panel()?.getAttribute("aria-label")).toBe("알림");
    expect(d.panel()?.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("오늘");
  });
});
