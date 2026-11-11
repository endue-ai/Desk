import { describe, expect, it } from "vitest";
import type { Permission, PermPromptData } from "../../../packages/bridge/src/index";
import { type Handlers, MANAGE, type Mounted, mount, plugin } from "./harness";

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins: [plugin("example.notes", "Notes", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: [] }),
    "perm.answer": () => ({}),
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
  it("shows its overlay and who asks, for what and why", async () => {
    const { host, view } = await prompted(core(), ask("p1"));
    expect(host.visible).toBe(true);
    expect(view.prompts.at(-1)).toEqual({
      promptId: "p1",
      title: "Notes asks for permission",
      caller: { id: "example.notes", name: "Notes", kind: "UI plugin" },
      permission: "Read files",
      scope: "~/Notes/**",
      reason: "To index your notes",
      duration: "This session",
      warning: null,
      parent: null,
      waiting: 0,
    });
  });

  it("shows the reason, and says when none was given", async () => {
    const { reason: _given, ...bare } = ask("p1");
    const { view } = await prompted(core(), bare);
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1", reason: "" });
  });

  it("offers the parent folder as a second Allow button", async () => {
    const pictures = (path: string): Permission => ({ permission: "fs:read", paths: [path] });
    const third = ask("p3", {
      permission: pictures("~/Pictures/2026/**"),
      parent: pictures("~/Pictures/**"),
    });
    const { app, view, params, settle } = await prompted(core(), third);
    expect(view.prompts.at(-1)).toMatchObject({
      scope: "~/Pictures/2026/**",
      parent: { scope: "~/Pictures/**", label: "Allow all of ~/Pictures (This session)" },
    });
    await app.answer("parent");
    await settle();
    expect(params("perm.answer")).toEqual([
      { promptId: "p3", granted: true, duration: "session", parent: true, scope: MANAGE },
    ]);
    expect(view.prompts.at(-1)).toBeNull();
    expect(view.statuses.at(-1)).toBe(
      "Allowed Notes: Read files in all of ~/Pictures (This session).",
    );
  });

  it("ignores the parent choice when no parent is offered", async () => {
    const { app, view, params, settle } = await prompted(core(), ask("p1"));
    await app.answer("parent");
    await settle();
    expect(params("perm.answer")).toEqual([]);
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1", parent: null });
  });

  it("names shell:open in words", async () => {
    const links: Permission = { permission: "shell:open", schemes: ["https", "mailto"] };
    const reason = "To open https://example.com/";
    const { view } = await prompted(core(), ask("p1", { permission: links, reason }));
    expect(view.prompts.at(-1)).toMatchObject({
      permission: "Open links (https, mailto) in your browser",
      scope: "",
      reason,
      warning: null,
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
    expect(host.visible).toBe(true);
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1", waiting: 2 });

    await app.answer("once");
    await settle();
    expect(view.prompts.at(-1)).toMatchObject({
      promptId: "p2",
      permission: "Show notifications",
      waiting: 1,
    });
    expect(view.statuses.at(-1)).toBe(
      "Allowed Notes: Read files (Once). Next: Notes asks for permission.",
    );
    await app.answer("refuse");
    await settle();
    expect(view.prompts.at(-1)).toMatchObject({
      promptId: "p3",
      title: "Desk asks for permission",
      waiting: 0,
    });
    expect(host.visible).toBe(true);

    await app.answer("always");
    await settle();
    expect(view.prompts.at(-1)).toBeNull();
    expect(params("perm.answer").map((p) => (p as { promptId: string }).promptId)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
    expect(host.visible).toBe(false);
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
    expect(view.statuses.at(-1)).toBe(
      "Could not answer Notes: internal. Next: Notes asks for permission.",
    );
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
});
