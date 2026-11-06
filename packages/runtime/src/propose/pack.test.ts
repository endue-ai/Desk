// @vitest-environment jsdom
// Packs in Make with Eris (ADR 0108): "Set up GitHub" (or "깃허브 연결해줘") routes to a pack
// proposal; the card previews what the pack brings (its connector, what it opens, its layout); Apply
// installs it from the market when the desk lacks it, turns it and its plugins on, switches to its
// profile, runs what it opens and leads to Settings, Connections on its connector. No brain call.
import {
  BridgeClient,
  browserStub,
  type MarketListing,
  type PluginInfo,
  type StubHandlers,
} from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { createCard } from "./card";
import { proposePack, serviceOf } from "./pack";
import { routeOf } from "./route";

const PACK: PluginInfo = {
  id: "desk.pack-github",
  status: "ready",
  enabled: false,
  builtIn: true,
  revision: 1,
  manifest: {
    id: "desk.pack-github",
    name: "GitHub",
    version: "0.1.0",
    kind: "pack",
    pack: {
      services: ["github", "깃허브"],
      plugins: ["desk.github"],
      opens: [{ command: "desk.pack-github.board" }],
      profile: "builder-morning",
    },
    contributes: {
      commands: [{ id: "desk.pack-github.board", title: "GitHub board" }],
      profiles: [{ id: "builder-morning", name: "Builder morning" }],
    },
  },
};
const GITHUB: PluginInfo = {
  id: "desk.github",
  status: "ready",
  enabled: false,
  builtIn: true,
  revision: 1,
  manifest: {
    id: "desk.github",
    name: "GitHub",
    version: "0.1.0",
    kind: "connector",
    connector: {
      binding: "http",
      auth: { kind: "token", title: "Personal access token" },
      resources: [{ kind: "task" }],
      sync: { mode: "pull" },
    },
  },
};

function desk(installed: PluginInfo[], market: MarketListing[] = []) {
  const plugins = structuredClone(installed);
  const calls: Array<{ method: string; params: unknown }> = [];
  const ran: Array<{ id: string; args?: unknown }> = [];
  const handlers: StubHandlers = {
    "plugin.list": () => ({ plugins: structuredClone(plugins) }),
    "plugin.setEnabled": (params) => {
      calls.push({ method: "plugin.setEnabled", params });
      const found = plugins.find((p) => p.id === params.plugin);
      if (found) found.enabled = params.enabled;
      return { plugin: structuredClone(found ?? plugins[0]) as PluginInfo };
    },
    "market.list": () => ({ entries: structuredClone(market), problems: [] }),
    "plugin.install": (params) => {
      calls.push({ method: "plugin.install", params });
      plugins.push(structuredClone(PACK), structuredClone(GITHUB));
      return { plugin: structuredClone(PACK) };
    },
  };
  const bridge = new BridgeClient(browserStub(handlers));
  const commands = {
    run: async (id: string, args?: unknown) => {
      ran.push(args === undefined ? { id } : { id, args });
      return {};
    },
  };
  const host = document.createElement("div");
  document.body.append(host);
  const card = createCard(host);
  const notes: string[] = [];
  const deps = { bridge, commands, card, notify: (n: { title: string }) => notes.push(n.title) };
  return { deps, calls, ran, host, notes };
}

const apply = async (host: HTMLElement) => {
  for (let i = 0; i < 20 && !host.querySelector('[data-choice="apply"]'); i++)
    await new Promise((r) => setTimeout(r, 0));
  host.querySelector<HTMLButtonElement>('[data-choice="apply"]')?.click();
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("packs in Make with Eris", () => {
  it("routes 'Set up GitHub' and '깃허브 연결해줘' to a pack proposal", () => {
    expect(serviceOf("Set up GitHub")).toBe("github");
    expect(serviceOf("set up my github")).toBe("github");
    expect(serviceOf("깃허브 연결해줘")).toBe("깃허브");
    expect(serviceOf("make a board of my tasks")).toBeNull();
    expect(routeOf("Set up GitHub")).toEqual({ to: "pack", service: "github" });
    expect(routeOf("make a board of my tasks").to).toBe("propose");
  });

  it("previews what the pack brings and applies it", async () => {
    const { deps, calls, ran, host } = desk([PACK, GITHUB]);
    const done = proposePack(deps, "github");
    await apply(host);
    const card = host.querySelector('[data-proposal="pack"]');
    expect(card?.textContent).toContain("GitHub");
    const outcome = await done;
    expect(outcome).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(host.textContent).toContain("Builder morning");
    expect(calls).toEqual([
      {
        method: "plugin.setEnabled",
        params: {
          plugin: "desk.pack-github",
          enabled: true,
          scope: { permission: "plugin:manage" },
        },
      },
      {
        method: "plugin.setEnabled",
        params: { plugin: "desk.github", enabled: true, scope: { permission: "plugin:manage" } },
      },
    ]);
    expect(ran).toEqual([
      { id: "desk.profiles.switch", args: { id: "builder-morning" } },
      { id: "desk.pack-github.board" },
      { id: "desk.connectors.open", args: { connector: "desk.github" } },
    ]);
  });

  it("installs a pack the desk lacks from the market first", async () => {
    const listing: MarketListing = {
      market: "https://raw.githubusercontent.com/endue-ai/Desk/main/market/packs/index.json",
      verified: true,
      state: "available",
      added: [{ permission: "net:fetch", hosts: ["api.github.com"] }],
      entry: {
        id: "desk.pack-github",
        kind: "pack",
        name: "GitHub",
        version: "0.1.0",
        publisher: "Team endue",
        license: "Apache-2.0",
        tags: ["github"],
        url: "https://example.test/github.desk-plugin",
        sha256: "0".repeat(64),
        size: 10,
        permissions: [{ permission: "net:fetch", hosts: ["api.github.com"] }],
      },
    };
    const { deps, calls, host } = desk([], [listing]);
    const done = proposePack(deps, "github");
    await apply(host);
    expect(await done).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(calls[0]).toEqual({
      method: "plugin.install",
      params: {
        id: "desk.pack-github",
        market: listing.market,
        accept: listing.entry.permissions,
        scope: { permission: "plugin:manage" },
      },
    });
  });

  it("says so when no pack serves the service", async () => {
    const { deps, notes } = desk([GITHUB]);
    expect(await proposePack(deps, "jira")).toEqual({ status: "none" });
    expect(notes[0]).toContain("jira");
  });
});
