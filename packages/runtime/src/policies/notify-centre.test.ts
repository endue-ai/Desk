// @vitest-environment jsdom
// desk.notify.history (Mod+Shift+N, unchanged) opens the notification centre instead of a palette
// list (#307): run again it closes it, and it still answers the history; `{ show: false }` only
// answers, for a caller that reads the history without a person.
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_KEYS } from "../core/keys";
import type { Notice } from "../notify";
import { centreDesk } from "../notify-centre/fixtures";

afterEach(() => document.body.replaceChildren());

describe("desk.notify.history", () => {
  it("desk.notify.history opens the panel", async () => {
    expect(DEFAULT_KEYS.find((k) => k.command === "desk.notify.history")?.key).toBe("Mod+Shift+N");
    const d = await centreDesk();
    // The palette's pick is no longer how the history shows.
    let picked = 0;
    d.hub.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: () => void picked++,
    });
    await d.hub.commands.settled();
    d.policy.notify({ caller: "desk", title: "Saved", level: "info" });

    const answered = (await d.hub.commands.run("desk.notify.history")) as Notice[];
    expect(answered.map((n) => n.title)).toEqual(["Saved"]);
    expect(d.panel()).not.toBeNull();
    expect(d.bell()?.getAttribute("aria-expanded")).toBe("true");
    expect(d.policy.notifications.unread()).toBe(0);

    const again = (await d.hub.commands.run("desk.notify.history")) as Notice[];
    expect(again.map((n) => n.title)).toEqual(["Saved"]);
    expect(d.panel()).toBeNull();
    expect(d.bell()?.getAttribute("aria-expanded")).toBe("false");

    d.policy.notify({ caller: "desk", title: "Built", level: "success" });
    const quiet = (await d.hub.commands.run("desk.notify.history", { show: false })) as Notice[];
    expect(quiet.map((n) => n.title)).toEqual(["Built", "Saved"]);
    expect(d.panel()).toBeNull();
    // Reading it without a person reads nothing for them.
    expect(d.policy.notifications.unread()).toBe(1);
    expect(picked).toBe(0);
  });

  it("desk.notify.clear empties the open panel too", async () => {
    const d = await centreDesk();
    d.policy.notify({ caller: "desk", title: "Saved", level: "info" });
    await d.hub.commands.run("desk.notify.history");
    expect(d.rows()).toHaveLength(1);
    await d.hub.commands.run("desk.notify.clear");
    expect(d.rows()).toHaveLength(0);
  });
});
