import { describe, expect, it } from "vitest";
import type { CallerGrant } from "../../../packages/bridge/src/index";
import { grant, type Handlers, MANAGE, mount, plugin } from "./harness";

const plugins = [plugin("example.notes", "Notes", "ui"), plugin("endue.eris", "Eris", "ui")];

/** A core that holds `grants`, lists them and forgets the ones revoked. */
function core(grants: CallerGrant[], extra: Handlers = {}): Handlers {
  let held = [...grants];
  return {
    "plugin.list": () => ({ plugins }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: held }),
    "perm.revoke": ({ grantId }) => {
      held = held.filter((g) => g.grant.grantId !== grantId);
      return {};
    },
    ...extra,
  };
}

const sample = [
  grant("example.notes", "g1", { permission: "fs:read", paths: ["~/Notes/**"] }, "always"),
  grant("endue.eris", "g2", { permission: "brain:converse" }),
  grant("example.notes", "g3", { permission: "net:fetch", hosts: ["*.com"] }, "once"),
  grant("desk", "g4", { permission: "plugin:manage" }),
];

describe("the grant list", () => {
  it("lists every caller's grants grouped by caller", async () => {
    const { view, params } = await mount(core(sample));
    expect(params("perm.list")).toEqual([{ scope: MANAGE }]);
    const list = view.lists.at(-1);
    expect(list?.summary).toBe("4 permissions held by 3 callers");
    expect(list?.groups.map((g) => g.caller)).toEqual([
      { id: "desk", name: "Desk", kind: "Runtime" },
      { id: "endue.eris", name: "Eris", kind: "UI plugin" },
      { id: "example.notes", name: "Notes", kind: "UI plugin" },
    ]);
    const notes = list?.groups[2];
    expect(notes?.grants).toEqual([
      {
        grantId: "g1",
        permission: "Read files",
        scope: "~/Notes/**",
        duration: "Always",
        warning: null,
        revokeLabel: "Revoke Read files (~/Notes/**) from Notes",
      },
      {
        grantId: "g3",
        permission: "Use the network",
        scope: "*.com",
        duration: "Once",
        warning: "It can reach every site under .com.",
        revokeLabel: "Revoke Use the network (*.com) from Notes",
      },
    ]);
    expect(list?.groups[1]?.grants[0]?.revokeLabel).toBe("Revoke Talk to the brain from Eris");
  });

  it("says when nobody holds a grant", async () => {
    const { view } = await mount(core([]));
    expect(view.lists.at(-1)).toEqual({ summary: "Nobody holds a permission.", groups: [] });
  });

  it("names callers by id when plugin.list is refused", async () => {
    const handlers = core(sample);
    delete handlers["plugin.list"];
    const { view } = await mount(handlers);
    const callers = view.lists.at(-1)?.groups.map((g) => g.caller);
    expect(callers?.[1]).toEqual({ id: "endue.eris", name: "endue.eris", kind: "Plugin" });
  });

  it("revokes a grant and refreshes the list", async () => {
    const { app, view, params, settle } = await mount(core(sample));
    await app.revoke("g1");
    await settle();
    expect(params("perm.revoke")).toEqual([{ grantId: "g1", scope: MANAGE }]);
    expect(params("perm.list")).toHaveLength(2);
    const notes = view.lists.at(-1)?.groups.find((g) => g.caller.id === "example.notes");
    expect(notes?.grants.map((g) => g.grantId)).toEqual(["g3"]);
    expect(view.statuses.at(-1)).toBe("Revoked Read files from Notes.");
  });

  it("refreshes on perm.changed for every caller", async () => {
    const held = [...sample];
    const { host, view, params, settle } = await mount(
      core([], { "perm.list": () => ({ grants: held }) }),
    );
    expect(params("events.subscribe")).toEqual([
      {
        names: ["perm.changed"],
        scope: { permission: "events:subscribe", names: ["perm.changed"] },
      },
    ]);
    expect(view.lists.at(-1)?.groups).toHaveLength(3);
    held.push(grant("example.other", "g5", { permission: "ui:notify" }));
    host.emit({ event: "perm.changed", data: { grantId: "g5", change: "granted" } });
    await settle();
    expect(params("perm.list")).toHaveLength(2);
    expect(view.lists.at(-1)?.groups.map((g) => g.caller.id)).toContain("example.other");
  });

  it("reports a refused revoke", async () => {
    const { app, view, methods, settle } = await mount(
      core(sample, {
        "perm.revoke": () => {
          throw new Error("the core said no");
        },
      }),
    );
    const before = view.lists.length;
    await app.revoke("g2");
    await settle();
    expect(methods().filter((m) => m === "perm.list")).toHaveLength(1);
    expect(view.lists).toHaveLength(before);
    expect(view.statuses.at(-1)).toBe("Could not revoke Talk to the brain from Eris: internal.");
  });
});
