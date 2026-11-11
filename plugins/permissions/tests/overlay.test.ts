// The prompter is a hidden overlay, never a window (07 #1, 08 #5): a card shows it in front of
// everything and the last answer hides it; the person's own opening shows the list, which stays
// until they close it; nothing leaves the overlay up with nothing on it.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PermApprovalData, PermPromptData } from "../../../packages/bridge/src/index";
import { type Handlers, MANAGE, type Mounted, mount, plugin } from "./harness";

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins: [plugin("example.sheets", "Sheets", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: [] }),
    "perm.answer": () => ({}),
    "perm.approve": () => ({}),
    ...extra,
  };
}

const ask = (promptId: string): PermPromptData => ({
  promptId,
  caller: "example.sheets",
  permission: { permission: "fs:write", paths: ["~/Documents/**"] },
  reason: "To save ~/Documents/budget.csv",
  duration: "session",
});

const approval: PermApprovalData = {
  approvalId: "a-1",
  caller: "agent:eris",
  action: "memory.remember",
  permission: { permission: "memory:write" } as PermApprovalData["permission"],
  target: "memory",
  preview: { kind: "fact", text: "I like barley tea" },
};

async function prompted(...prompts: PermPromptData[]): Promise<Mounted> {
  const mounted = await mount(core());
  for (const data of prompts) mounted.host.emit({ event: "perm.prompt", data });
  await mounted.settle();
  return mounted;
}

describe("the manifest", () => {
  it("has one surface, a hidden overlay, so no window close ends the prompter", () => {
    const manifest = JSON.parse(readFileSync(new URL("../plugin.json", import.meta.url), "utf8"));
    expect(manifest.surfaces).toEqual([
      { id: "main", title: "Permissions", placement: "overlay", hidden: true },
    ]);
  });
});

describe("the overlay", () => {
  it("stays hidden until a card comes, shows for it and hides after the last answer", async () => {
    const mounted = await mount(core());
    expect(mounted.host.visible).toBeUndefined();
    mounted.host.emit({ event: "perm.prompt", data: ask("p1") });
    mounted.host.emit({ event: "perm.approval", data: approval });
    await mounted.settle();
    expect(mounted.host.visible).toBe(true);
    expect(mounted.view.sheets).toEqual([]);

    await mounted.app.answer("once");
    await mounted.settle();
    expect(mounted.host.visible).toBe(true);
    await mounted.app.answer("deny");
    await mounted.settle();
    expect(mounted.host.visible).toBe(false);
  });

  it("does not ask again for a card delivered again after its answer", async () => {
    const { app, host, view, params, settle } = await prompted(ask("p1"));
    await app.answer("refuse");
    await settle();
    host.emit({ event: "perm.prompt", data: ask("p1") });
    await settle();
    expect(view.prompts.at(-1)).toBeNull();
    expect(host.visible).toBe(false);
    expect(params("perm.answer")).toEqual([{ promptId: "p1", granted: false, scope: MANAGE }]);
  });

  it("shown by the desk with no card, shows the list; Escape closes it and hides the overlay", async () => {
    const { app, host, view } = await mount(core());
    app.opened();
    expect(view.sheets.at(-1)).toBe(true);
    expect(app.key("Escape")).toBe(true);
    expect(view.sheets.at(-1)).toBe(false);
    expect(host.visible).toBe(false);
  });

  it("keeps the list open after a card that came while it was open", async () => {
    const { app, host, view, settle } = await mount(core());
    app.opened();
    host.emit({ event: "perm.prompt", data: ask("p1") });
    await settle();
    expect(host.visible).toBe(true);
    await app.answer("once");
    await settle();
    expect(view.prompts.at(-1)).toBeNull();
    expect(host.visible).toBe(true);
    app.close();
    expect(host.visible).toBe(false);
  });

  it("is not the list when it showed itself for a card", async () => {
    const { app, view, settle } = await prompted(ask("p1"));
    // The page hears its own showing (visible, focused) after it asked for it.
    app.opened();
    await app.answer("refuse");
    await settle();
    expect(view.sheets).toEqual([]);
  });

  it("a press beside a card does nothing; beside the list it closes the list", async () => {
    const { app, host, view, params, settle } = await prompted(ask("p1"));
    app.dismiss();
    await settle();
    expect(host.visible).toBe(true);
    expect(view.prompts.at(-1)).toMatchObject({ promptId: "p1" });
    expect(params("perm.answer")).toEqual([]);

    await app.answer("once");
    await settle();
    app.opened();
    app.dismiss();
    expect(view.sheets.at(-1)).toBe(false);
    expect(host.visible).toBe(false);
  });

  it("Escape with nothing on it still hides the overlay", async () => {
    const { app, host } = await mount(core());
    expect(app.key("Escape")).toBe(true);
    expect(host.visible).toBe(false);
  });

  it("a page that loads again shows the cards that still wait, and only those", async () => {
    const first = await prompted(ask("p1"), ask("p2"));
    await first.app.answer("once");
    await first.settle();
    // The renderer died or the page loaded again: the desk hands it what it kept.
    const again = await mount(core(), first.host.state);
    expect(again.host.visible).toBe(true);
    expect(again.view.prompts.at(-1)).toMatchObject({ promptId: "p2", waiting: 0 });
    await again.app.answer("refuse");
    await again.settle();
    expect(again.params("perm.answer")).toEqual([
      { promptId: "p2", granted: false, scope: MANAGE },
    ]);
    expect(again.host.visible).toBe(false);
    expect(again.host.state).toMatchObject({ cards: [] });
  });

  it("shown again by the desk with a card waiting shows the card, and the answer hides it", async () => {
    const { app, host, view, settle } = await prompted(ask("p1"));
    // The desk hid the page (the app window out of sight); it shows it again later.
    app.hidden();
    app.opened();
    expect(view.sheets.at(-1)).toBe(false);
    await app.answer("once");
    await settle();
    expect(host.visible).toBe(false);
  });
});
