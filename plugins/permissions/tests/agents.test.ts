import { describe, expect, it } from "vitest";
import { describeCaller } from "../ui/describe.js";
import { grant, type Handlers, mount, plugin } from "./harness";

const plugins = [plugin("example.notes", "Notes", "ui")];

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({
      grants: [
        grant("agent:mira", "g1", { permission: "fs:write", paths: ["~/Notes/**"] }, "always"),
        grant("example.notes", "g2", { permission: "fs:read", paths: ["~/Notes/**"] }),
        grant("agent:ag_01", "g3", { permission: "cmd:invoke", ids: ["notes.*"] }),
      ],
    }),
    "perm.answer": () => ({}),
    "ui.surface.open": () => ({ handle: "overlay-1" }),
    ...extra,
  };
}

describe("agents (ADR 0072)", () => {
  it("are callers of their own kind, named by their id", () => {
    expect(describeCaller("agent:mira", plugins)).toEqual({
      id: "agent:mira",
      name: "Agent mira",
      kind: "Agent",
    });
  });

  it("are listed apart from plugins", async () => {
    const { view } = await mount(core());
    const list = view.lists.at(-1);
    expect(list?.summary).toBe("3 permissions held by 3 callers");
    expect(list?.groups.map((g) => g.caller.id)).toEqual(["example.notes"]);
    expect(list?.agents.map((g) => g.caller)).toEqual([
      { id: "agent:ag_01", name: "Agent ag_01", kind: "Agent" },
      { id: "agent:mira", name: "Agent mira", kind: "Agent" },
    ]);
    expect(list?.agents[1]?.grants[0]).toMatchObject({
      grantId: "g1",
      permission: "Write files",
      scope: "~/Notes/**",
      duration: "Always",
      revokeLabel: "Revoke Write files (~/Notes/**) from Agent mira",
    });
  });

  it("are named in the prompt", async () => {
    const mounted = await mount(core());
    mounted.host.emit({
      event: "perm.prompt",
      data: {
        promptId: "p1",
        caller: "agent:mira",
        permission: { permission: "fs:write", paths: ["~/Notes/**"] },
        reason: "Its tool call fs.write needs this for ~/Notes/today.md",
        duration: "session",
      },
    });
    await mounted.settle();
    expect(mounted.view.prompts.at(-1)).toMatchObject({
      title: "Agent mira asks for permission",
      caller: { id: "agent:mira", name: "Agent mira", kind: "Agent" },
      permission: "Write files",
      scope: "~/Notes/**",
    });
    await mounted.app.answer("session");
    await mounted.settle();
    expect(mounted.view.statuses.at(-1)).toBe("Allowed Agent mira: Write files (This session).");
  });
});
