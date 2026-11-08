// Eris's tools map to computer.* (ADR 0088, ADR 0123): each act carries the invocation it serves,
// so the core holds it as her act; the scope is the person's app list; reads only read.
import { describe, expect, it } from "vitest";
import { explain } from "../ui/app.js";
import { mount, StubError } from "./harness";

describe("the tools", () => {
  it("map to computer.*, every act naming Eris's invocation", async () => {
    const { invokeAs, computer } = await mount();
    const acts: Array<[string, Record<string, unknown>, string, Record<string, unknown>]> = [
      ["click", { x: 120, y: 340 }, "computer.input.click", { x: 120, y: 340, count: 1 }],
      [
        "click",
        { element: { pid: 412, path: [0, 3], role: "AXButton" } },
        "computer.ax.perform",
        { element: { pid: 412, path: [0, 3], role: "AXButton" }, action: "press" },
      ],
      ["type", { text: "안녕하세요" }, "computer.input.type", { text: "안녕하세요" }],
      ["keys", { keys: ["cmd+t", "cmd+l"] }, "computer.input.keys", { keys: ["cmd+t", "cmd+l"] }],
      ["keys", { keys: "return" }, "computer.input.keys", { keys: ["return"] }],
      ["scroll", { dy: 3 }, "computer.input.scroll", { dx: 0, dy: 3 }],
      ["open", { app: "com.apple.Notes" }, "computer.apps.launch", { bundleId: "com.apple.Notes" }],
      ["open", { app: "textedit" }, "computer.apps.activate", { pid: 530 }],
      ["switch", { app: "530" }, "computer.apps.activate", { pid: 530 }],
    ];
    for (const [tool, args, method, params] of acts) {
      const before = computer(method).length;
      const invocationId = await invokeAs("agent:eris", `endue.computer.${tool}`, args);
      const call = computer(method)[before];
      expect(call, `${tool} ${JSON.stringify(args)}`).toBeDefined();
      expect(call?.params).toEqual({
        ...params,
        invocationId,
        scope: { permission: "computer:control" },
      });
    }
  });

  it("look reads the screen and the focused window as elements to click, and only reads", async () => {
    const { host, computer, calls } = await mount();
    const seen = (await host.invoke("endue.computer.look", {})) as {
      app: unknown;
      elements: unknown[];
      image: string;
    };
    expect(computer("computer.ax.tree")[0]?.params).toEqual({
      depth: 8,
      nodes: 300,
      scope: { permission: "computer:see" },
    });
    expect(computer("computer.screenshot")[0]?.params).toMatchObject({
      maxWidth: 1280,
      maxHeight: 800,
    });
    expect(seen.app).toEqual({ name: "Safari", bundleId: "com.apple.Safari", pid: 412 });
    expect(seen.elements[1]).toEqual({
      element: { pid: 412, path: [0, 0], role: "AXButton" },
      label: "Send",
      at: { x: 140, y: 212 },
      actions: ["AXPress"],
    });
    expect(seen.image).toBe("iVBORw0KGgo=");
    const acting = /^computer\.(input\.|ax\.perform|apps\.(launch|activate|quit)|stop)/;
    expect(calls.filter((c) => acting.test(c.method))).toEqual([]);
  });

  it("carry the person's app list as their scope", async () => {
    const apps = ["com.apple.Safari"];
    const { invokeAs, computer } = await mount({ settings: { apps } });
    await invokeAs("agent:eris", "endue.computer.click", { x: 1, y: 2 });
    expect(computer("computer.input.click")[0]?.params.scope).toEqual({
      permission: "computer:control",
      apps,
    });
    await invokeAs("agent:eris", "endue.computer.apps");
    expect(computer("computer.apps.list")[0]?.params.scope).toEqual({
      permission: "computer:see",
      apps,
    });
  });

  it("act as the person's own from the palette, and refuse to be another plugin's deputy", async () => {
    const { host, invokeAs, computer } = await mount();
    const answer = await host.invoke("endue.computer.click", { x: 5, y: 6 });
    expect(answer).toEqual({
      summary: "click left at (5, 6) in Safari",
      app: { name: "Safari", bundleId: "com.apple.Safari", pid: 412 },
    });
    expect(computer("computer.input.click")[0]?.params).toEqual({
      x: 5,
      y: 6,
      count: 1,
      scope: { permission: "computer:control" },
    });
    await invokeAs("example.other", "endue.computer.type", { text: "x" });
    expect(computer("computer.input.type")).toEqual([]);
  });

  it("tell the agent what a failure means", async () => {
    const stopped = new StubError("cancelled", "click: stopped before it started");
    expect(explain(stopped)).toMatch(/stopped computer use/);
    const refused = new StubError("permission_denied", "the person did not approve agent:eris's");
    expect(explain(refused)).toMatch(/did not approve/);
    const os = new StubError("permission_denied", "needs the Accessibility permission");
    expect(explain(os)).toMatch(/Computer page/);
    expect(explain(new StubError("unsupported", "no driver"))).toMatch(/not available/);
  });
});
