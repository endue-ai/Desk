import { describe, expect, it } from "vitest";
import type { PermPromptData } from "../../../packages/bridge/src/index";
import { type Handlers, MANAGE, type Mounted, mount, plugin } from "./harness";

const SURFACE = { permission: "ui:surface" } as const;

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins: [plugin("example.notes", "Notes", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: [] }),
    "perm.answer": () => ({}),
    "ui.surface.open": () => ({ handle: "overlay-1" }),
    "ui.surface.close": () => ({}),
    ...extra,
  };
}

const ask = (promptId: string, extra: Partial<PermPromptData> = {}): PermPromptData => ({
  promptId,
  caller: "example.notes",
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  reason: "To index your notes",
  duration: "session",
  ...extra,
});

async function prompted(handlers: Handlers, ...prompts: PermPromptData[]): Promise<Mounted> {
  const mounted = await mount(handlers);
  for (const data of prompts) mounted.host.emit({ event: "perm.prompt", data });
  await mounted.settle();
  return mounted;
}

describe("the prompt", () => {
  it("opens the overlay and shows who asks, for what and why", async () => {
    const { view, params } = await prompted(core(), ask("p1"));
    expect(params("ui.surface.open")).toEqual([
      { surface: "prompt", title: "Permission request", scope: SURFACE },
    ]);
    expect(view.prompts.at(-1)).toEqual({
      promptId: "p1",
      title: "Notes asks for permission",
      caller: { id: "example.notes", name: "Notes", kind: "UI plugin" },
      permission: "Read files",
      scope: "~/Notes/**",
      reason: "To index your notes",
      duration: "This session",
      warning: null,
      waiting: 0,
    });
  });

  it.each(["once", "session", "always"] as const)(
    "answers with the chosen duration: %s",
    async (duration) => {
      const { app, view, params, settle } = await prompted(core(), ask("p1"));
      await app.answer(duration);
      await settle();
      expect(params("perm.answer")).toEqual([
        { promptId: "p1", granted: true, duration, scope: MANAGE },
      ]);
      expect(view.prompts.at(-1)).toBeNull();
      expect(view.statuses.at(-1)).toMatch(/^Allowed Notes: Read files \(.+\)\.$/);
    },
  );

  it("refuses from the button and from Escape", async () => {
    const { app, view, params, settle } = await prompted(core(), ask("p1"), ask("p2"));
    await app.answer("refuse");
    await settle();
    expect(app.key("Escape")).toBe(true);
    await settle();
    expect(params("perm.answer")).toEqual([
      { promptId: "p1", granted: false, scope: MANAGE },
      { promptId: "p2", granted: false, scope: MANAGE },
    ]);
    expect(view.statuses.at(-1)).toBe("Refused Notes: Read files.");
    expect(app.key("Escape")).toBe(false);
    expect(app.key("Enter")).toBe(false);
    await settle();
    expect(params("perm.answer")).toHaveLength(2);
  });

  it("shows one prompt at a time and queues the rest", async () => {
    const { app, host, view, params, settle } = await prompted(
      core(),
      ask("p1"),
      ask("p2", { permission: { permission: "ui:notify" } }),
      ask("p3", { caller: "desk", permission: { permission: "plugin:manage" } }),
    );
    host.emit({ event: "perm.prompt", data: ask("p2") });
    await settle();
    expect(params("ui.surface.open")).toHaveLength(1);
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1", waiting: 2 });

    await app.answer("once");
    await settle();
    expect(view.prompts.at(-1)).toMatchObject({
      promptId: "p2",
      permission: "Show notifications",
      waiting: 1,
    });
    await app.answer("refuse");
    await settle();
    expect(view.prompts.at(-1)).toMatchObject({
      promptId: "p3",
      title: "Desk asks for permission",
      waiting: 0,
    });
    expect(params("ui.surface.close")).toEqual([]);

    await app.answer("always");
    await settle();
    expect(view.prompts.at(-1)).toBeNull();
    expect(params("perm.answer").map((p) => (p as { promptId: string }).promptId)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(params("ui.surface.close")).toEqual([{ handle: "overlay-1", scope: SURFACE }]);
  });

  it("moves on when an answer fails", async () => {
    let calls = 0;
    const handlers = core({
      "perm.answer": () => {
        calls++;
        if (calls === 1) throw new Error("already decided");
        return {};
      },
    });
    const { app, view, settle } = await prompted(handlers, ask("p1"), ask("p2"));
    await app.answer("session");
    await settle();
    expect(view.statuses.at(-1)).toBe("Could not answer Notes: internal.");
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p2", waiting: 0 });
  });

  it("warns when the request is broad", async () => {
    const broad = ask("p1", { permission: { permission: "proc:spawn", commands: ["zsh"] } });
    const { view } = await prompted(core(), broad);
    expect(view.prompts.at(-1)).toMatchObject({
      permission: "Run programs",
      scope: "zsh",
      warning: "It can run any program through zsh.",
    });
  });

  it("still prompts when the overlay cannot open", async () => {
    const handlers = core();
    delete handlers["ui.surface.open"];
    const { app, view, params, settle } = await prompted(handlers, ask("p1"));
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1" });
    await app.answer("once");
    await settle();
    expect(params("perm.answer")).toHaveLength(1);
    expect(params("ui.surface.close")).toEqual([]);
  });
});
