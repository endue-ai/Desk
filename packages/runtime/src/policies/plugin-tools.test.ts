// @vitest-environment jsdom
import type { CallerGrant, PluginManifest } from "@endue-ai/bridge";
import { afterEach, expect, it, vi } from "vitest";
import { browserCore } from "../bridge/core";
import { ManualClock } from "../clock";
import { createRuntime } from "../runtime";
import { invokeAsEris } from "./agent-tool-test";

const network = "example.network";
const agents = "example.agents";
const permissions = "endue.permissions";
const policy = (id: string, more: Partial<PluginManifest> = {}): PluginManifest => ({
  id,
  kind: "policy",
  version: "1.0.0",
  ...more,
});

const held = (caller: string, grantId: string, permission: CallerGrant["grant"]["permission"]) => ({
  caller,
  grant: { grantId, permission, duration: "session" as const, grantedAt: "2026-11-26T00:00:00Z" },
});

async function desk() {
  const grants = [
    held(network, "net", { permission: "net:fetch", hosts: ["example.test"] }),
    held("agent:eris", "files", { permission: "fs:read", paths: ["~/Notes/**"] }),
    held(permissions, "manage", { permission: "perm:manage" }),
    held("desk", "core", { permission: "plugin:manage" }),
  ];
  const list = vi.fn(({ caller }: { caller?: string }) => ({
    grants: grants.filter((entry) => !caller || entry.caller === caller),
  }));
  const revoke = vi.fn(({ grantId }: { grantId: string }) => {
    const at = grants.findIndex((entry) => entry.grant.grantId === grantId);
    if (at < 0) throw new Error("missing");
    grants.splice(at, 1);
    return {};
  });
  const themes = [
    {
      entry: { id: "example.lagoon", name: "Lagoon blue", kind: "theme", version: "1.0.0" },
      state: "available",
      market: "https://example.test/index.json",
      verified: false,
      added: [],
    },
    {
      entry: { id: "example.blue-board", name: "Blue board", kind: "view", version: "1.0.0" },
      state: "available",
      market: "https://example.test/index.json",
      verified: false,
      added: [],
    },
  ] as const;
  const core = browserCore({
    manifests: [
      policy(network, { name: "The Network" }),
      { ...policy(agents, { name: "Agents", autoload: true }), kind: "ui", entry: "ui/index.html" },
      policy(permissions, { permissions: [{ permission: "perm:manage" }] }),
    ],
    handlers: {
      "perm.list": list,
      "perm.revoke": revoke,
      "market.list": () => ({ entries: [...themes], problems: [] }),
    },
  });
  const root = document.createElement("div");
  document.body.append(root);
  const runtime = createRuntime({ root, bridge: core.client, clock: new ManualClock() });
  await runtime.ready;
  await runtime.commands.settled();
  return { core, runtime, list, revoke };
}

afterEach(() => document.body.replaceChildren());

it("lists installed plugins by state and query, including off autoload plugins", async () => {
  const { core, runtime } = await desk();
  try {
    runtime.openSurface({ id: network, title: "Network" });
    expect(runtime.commands.readOnly("desk.plugins.list")).toBe(true);
    expect(
      await invokeAsEris(core.client, "desk.plugins.list", { state: "open", query: "net" }),
    ).toEqual({
      plugins: [
        {
          id: network,
          name: "The Network",
          kind: "policy",
          enabled: true,
          autoload: false,
          open: true,
        },
      ],
    });
    expect(await invokeAsEris(core.client, "desk.plugins.list", { state: "off" })).toEqual({
      plugins: [
        { id: agents, name: "Agents", kind: "ui", enabled: false, autoload: true, open: false },
      ],
    });
  } finally {
    runtime.dispose();
  }
});

it("leaves a plugin on when the person keeps a dirty buffer and protects the permission responder", async () => {
  const { core, runtime } = await desk();
  let answer = "cancel";
  const pick = vi.fn(() => answer);
  runtime.commands.define("desk.palette.pick", { owner: "desk", title: "Choose", run: pick });
  runtime.buffers.add({ id: "draft", name: "Draft", plugin: network, modified: true });
  await runtime.commands.settled();
  try {
    const turnOff = (plugin: string) =>
      invokeAsEris(core.client, "desk.plugins.turn-off", { plugin });
    await expect(turnOff(network)).rejects.toThrow(/cancel/i);
    expect(core.plugins.find((p) => p.id === network)?.enabled).toBe(true);
    expect(pick).toHaveBeenCalledOnce();
    answer = "discard";
    await expect(turnOff(network)).resolves.toMatchObject({ id: network, enabled: false });
    expect(core.plugins.find((p) => p.id === network)?.enabled).toBe(false);
    await expect(turnOff(permissions)).rejects.toThrow(/permissions/i);
    expect(core.plugins.find((p) => p.id === permissions)?.enabled).toBe(true);
  } finally {
    runtime.dispose();
  }
});

it("only lists plugin and agent grants and revokes one exact, eligible grant", async () => {
  const { core, runtime, list, revoke } = await desk();
  try {
    expect(runtime.commands.readOnly("endue.permissions.grants")).toBe(true);
    const grants = (args = {}) => invokeAsEris(core.client, "endue.permissions.grants", args);
    expect(await grants()).toMatchObject({
      grants: [{ caller: network }, { caller: "agent:eris" }, { caller: permissions }],
    });
    expect(await grants({ caller: network })).toMatchObject({ grants: [{ caller: network }] });
    expect(list).toHaveBeenLastCalledWith(
      { caller: network, scope: { permission: "perm:manage" } },
      undefined,
    );
    const remove = (grant: string) =>
      invokeAsEris(core.client, "endue.permissions.revoke", { grant });
    await expect(remove("core")).rejects.toThrow();
    await expect(remove("manage")).rejects.toThrow();
    expect(revoke).not.toHaveBeenCalled();
    await expect(remove("net")).resolves.toMatchObject({ grant: "net", revoked: true });
    expect(revoke.mock.calls.map(([p]) => p.grantId)).toEqual(["net"]);
    expect(await grants({ caller: network })).toEqual({ grants: [] });
  } finally {
    runtime.dispose();
  }
});

it("discovers a read-only market search and an irreversible install", async () => {
  const { core, runtime } = await desk();
  try {
    expect(runtime.commands.readOnly("desk.market.search")).toBe(true);
    expect(runtime.commands.list().find((c) => c.id === "desk.market.install")).toMatchObject({
      irreversible: true,
    });
    expect(
      await invokeAsEris(core.client, "desk.market.search", { kind: "theme", query: " BLUE " }),
    ).toMatchObject({ entries: [{ id: "example.lagoon", kind: "theme" }] });
  } finally {
    runtime.dispose();
  }
});
