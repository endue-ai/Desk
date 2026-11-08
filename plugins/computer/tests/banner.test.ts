// The banner while an agent operates the computer (ADR 0123): it shows from her first act, says
// what she does and where, stays between acts, says Stopped after the stop until Resume, and leaves
// the person's own acts alone. Stop and Resume go back to the desk.
import { describe, expect, it } from "vitest";
import { bannerModel, firstActivity, HIDDEN } from "../ui/banner.js";
import { mount } from "./harness";

const acting = {
  state: "acting",
  caller: "endue.computer",
  agent: "eris",
  action: "click left at (120, 340)",
  app: "Safari",
};

describe("the banner", () => {
  it("shows while Eris operates the computer, with what she does", () => {
    const shown = bannerModel(HIDDEN, acting);
    expect(shown).toEqual({
      visible: true,
      stopped: false,
      title: "Eris is using your computer",
      detail: "click left at (120, 340) in Safari",
    });
    const done = bannerModel(shown, { ...acting, state: "done" });
    expect(done.visible).toBe(true);
    expect(done.detail).toBe("Did: click left at (120, 340) in Safari");
    const mira = bannerModel(HIDDEN, { ...acting, agent: "mira" });
    expect(mira.title).toBe("Mira is using your computer");
  });

  it("leaves the person's own acts alone", () => {
    expect(bannerModel(HIDDEN, { state: "acting", caller: "desk", action: "type" })).toBe(HIDDEN);
  });

  it("says Stopped after the stop, until Resume", () => {
    const stopped = bannerModel(bannerModel(HIDDEN, acting), { state: "stopped", caller: "core" });
    expect(stopped).toMatchObject({ visible: true, stopped: true, title: "Stopped" });
    expect(bannerModel(stopped, acting).stopped).toBe(true);
    expect(bannerModel(stopped, { state: "resumed", caller: "desk" })).toEqual(HIDDEN);
  });

  it("opens with the activity the desk put in its URL", () => {
    const hash = `#${encodeURIComponent(JSON.stringify(acting))}`;
    expect(firstActivity(hash)).toEqual(acting);
    expect(firstActivity("")).toBeNull();
    expect(firstActivity("#not json")).toBeNull();
  });

  it("shows on the Computer page while an agent acts, and its Stop stops", async () => {
    const { host, last, computer, app } = await mount();
    host.emit({ event: "computer.activity", data: acting as never });
    expect(last().banner).toMatchObject({ visible: true, title: "Eris is using your computer" });
    await app.page.stop();
    expect(computer("computer.stop")[0]?.params).toEqual({
      scope: { permission: "computer:control" },
    });
    host.emit({ event: "computer.activity", data: { state: "stopped", caller: "endue.computer" } });
    expect(last().banner.stopped).toBe(true);
    expect(last().stopped).toBe(true);
  });
});
