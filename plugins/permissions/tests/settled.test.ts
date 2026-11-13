// A card another prompter answered (the island, ADR 0204) or whose caller went leaves the overlay
// with perm.settled; the card this page is answering leaves with its own answer, once.
import { describe, expect, it } from "vitest";
import type { PermApprovalData, PermPromptData } from "../../../packages/bridge/src/index";
import { type Handlers, type Mounted, mount, plugin } from "./harness";

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins: [plugin("example.notes", "Notes", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: [] }),
    "perm.answer": () => ({}),
    "perm.approve": () => ({}),
    ...extra,
  };
}

const ask = (promptId: string): PermPromptData => ({
  promptId,
  caller: "example.notes",
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  duration: "session",
});

const write: PermApprovalData = {
  approvalId: "a-1",
  caller: "agent:mira",
  action: "fs.write",
  permission: { permission: "fs:write", paths: ["~/Notes/**"] },
  target: "~/Notes/a.md",
};

const settled = (mounted: Mounted, kind: "prompt" | "approval", id: string) =>
  mounted.host.emit({ event: "perm.settled", data: { kind, id } });

describe("a card answered elsewhere", () => {
  it("leaves the queue, and the overlay goes with the last one", async () => {
    const mounted = await mount(core());
    mounted.host.emit({ event: "perm.prompt", data: ask("p-1") });
    mounted.host.emit({ event: "perm.prompt", data: ask("p-2") });
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p-1", waiting: 1 });

    settled(mounted, "prompt", "p-2");
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p-1", waiting: 0 });
    expect(mounted.host.visible).toBe(true);

    settled(mounted, "prompt", "p-1");
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toBeNull();
    expect(mounted.host.visible).toBe(false);
    expect(mounted.params("perm.answer"), "nothing answered here").toEqual([]);
    // The same prompt delivered again is not asked twice.
    mounted.host.emit({ event: "perm.prompt", data: ask("p-1") });
    await mounted.settle();
    expect(mounted.host.visible).toBe(false);
  });

  it("gives the approval in front way to the next card", async () => {
    const mounted = await mount(core());
    mounted.host.emit({ event: "perm.approval", data: write });
    mounted.host.emit({ event: "perm.prompt", data: ask("p-1") });
    await mounted.settle();
    expect(mounted.view.approvals.at(-1)).toMatchObject({ approvalId: "a-1", waiting: 1 });
    settled(mounted, "approval", "a-1");
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p-1", waiting: 0 });
    // A settled card it never had changes nothing.
    settled(mounted, "approval", "a-404");
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p-1" });
  });

  it("takes the card it answers off once, when its own answer settles it", async () => {
    let mounted: Mounted | undefined;
    const handlers = core({
      "perm.answer": (params: unknown) => {
        const { promptId } = params as { promptId: string };
        mounted?.host.emit({ event: "perm.settled", data: { kind: "prompt", id: promptId } });
        return {};
      },
    });
    mounted = await mount(handlers);
    mounted.host.emit({ event: "perm.prompt", data: ask("p-1") });
    mounted.host.emit({ event: "perm.prompt", data: ask("p-2") });
    await mounted.settle();
    await mounted.app.answer("once");
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p-2", waiting: 0 });
    expect(mounted.host.visible).toBe(true);
  });
});
