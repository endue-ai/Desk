// The Computer page (ADR 0123): what macOS allows (Accessibility, Screen Recording) with why and
// the bundle it asks about, Ask and Open System Settings, Stop and Resume, the apps Eris may
// operate, and what was done lately; off macOS it says computer use is not available.
import { describe, expect, it } from "vitest";
import { WHY } from "../ui/page.js";
import { mount, StubError } from "./harness";

describe("the Computer page", () => {
  it("shows what the OS allows, why each is asked, and which app macOS asks about", async () => {
    const { last } = await mount();
    const shown = last();
    expect(shown.state).toBe("ready");
    expect(shown.permissions).toEqual([
      { id: "accessibility", label: "Accessibility", granted: true, why: WHY.accessibility },
      {
        id: "screen-recording",
        label: "Screen Recording",
        granted: false,
        why: WHY["screen-recording"],
      },
    ]);
    expect(shown.message).toBe("macOS asks about ai.endue.desk.");
    expect(shown.stopped).toBe(false);
  });

  it("asks macOS and opens System Settings for a permission", async () => {
    const { app, computer, said } = await mount();
    await app.page.ask("screen-recording");
    await app.page.openSettings("screen-recording");
    const see = { permission: "computer:see" };
    expect(computer("computer.permissions.request")[0]?.params).toEqual({
      permission: "screen-recording",
      scope: see,
    });
    expect(computer("computer.permissions.open")[0]?.params).toEqual({
      permission: "screen-recording",
      scope: see,
    });
    expect(said.at(-1)).toMatch(/System Settings is open/);
  });

  it("says computer use is not available off macOS", async () => {
    const unsupported = () => {
      throw new StubError("unsupported", "computer use is not available on linux yet");
    };
    const { last } = await mount({ handlers: { "computer.permissions.status": unsupported } });
    expect(last()).toMatchObject({
      state: "unsupported",
      message: "Computer use works on macOS for now.",
    });
  });

  it("stops and resumes", async () => {
    const { app, computer } = await mount();
    await app.page.stop();
    await app.page.resume();
    const control = { permission: "computer:control" };
    expect(computer("computer.stop").map((c) => c.params)).toEqual([
      { scope: control },
      { resume: true, scope: control },
    ]);
  });

  it("keeps the apps Eris may operate, refusing what is not a bundle id", async () => {
    const { app, host, last, said } = await mount();
    await app.page.addApp("com.apple.Safari");
    await app.page.addApp("Safari app");
    expect(said.at(-1)).toMatch(/not a bundle id/);
    expect(host.settings.apps).toEqual(["com.apple.Safari"]);
    expect(last().apps).toEqual(["com.apple.Safari"]);
    await app.page.removeApp("com.apple.Safari");
    expect(host.settings.apps).toEqual([]);
  });

  it("lists what agents did lately", async () => {
    const { host, last } = await mount();
    const act = { caller: "endue.computer", agent: "eris", action: "type", app: "Notes" };
    host.emit({ event: "computer.activity", data: { ...act, state: "acting" } as never });
    host.emit({ event: "computer.activity", data: { ...act, state: "done" } as never });
    host.emit({ event: "computer.activity", data: { ...act, state: "failed" } as never });
    expect(last().recent.map((r) => [r.who, r.what, r.app, r.state])).toEqual([
      ["Eris", "type", "Notes", "failed"],
      ["Eris", "type", "Notes", "done"],
    ]);
  });
});
