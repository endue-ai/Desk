// @vitest-environment jsdom
// Packs in Make with Eris (ADR 0108): "Set up GitHub" (or "깃허브 연결해줘") routes to a pack
// proposal; the card previews what the pack brings (its connector, what it opens, its layout); Apply
// installs it from the market when the desk lacks it, turns it and its plugins on, switches to its
// profile and leaves the person in front of the next step: the token form while its connector has no
// account, else what it opens. Undo takes back what Apply did. No brain call.
import {
  BridgeClient,
  browserStub,
  type ConnectorInstance,
  type MarketListing,
  type PluginInfo,
  type StubHandlers,
} from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { createCard } from "./card";
import { proposePack, serviceOf, setUpPack } from "./pack";
import { routeOf } from "./route";

const PLUGINS = { permission: "plugin:manage" } as const;
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
    description: "Your GitHub work set up in one go.",
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
/** An account of desk.github, connected: fixture data, no token. */
const ACCOUNT: ConnectorInstance = {
  connector: "desk.github",
  instance: "default",
  status: { state: "connected" },
};
const LISTING: MarketListing = {
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

interface Setup {
  installed: PluginInfo[];
  market?: MarketListing[];
  accounts?: ConnectorInstance[];
  /** The profile in force before Apply. */
  active?: string;
  /** What desk.palette.pick answers; absent: the palette is off. */
  pick?: () => unknown;
}

function desk(setup: Setup) {
  const plugins = structuredClone(setup.installed);
  const calls: Array<{ method: string; params: unknown }> = [];
  const ran: Array<{ id: string; args?: unknown }> = [];
  let active = setup.active ?? "default";
  const handlers: StubHandlers = {
    "plugin.list": () => ({ plugins: structuredClone(plugins) }),
    "plugin.setEnabled": (params) => {
      calls.push({ method: "plugin.setEnabled", params });
      const found = plugins.find((p) => p.id === params.plugin);
      if (found) found.enabled = params.enabled;
      return { plugin: structuredClone(found ?? plugins[0]) as PluginInfo };
    },
    "market.list": () => ({ entries: structuredClone(setup.market ?? []), problems: [] }),
    "plugin.install": (params) => {
      calls.push({ method: "plugin.install", params });
      plugins.push(structuredClone(PACK), structuredClone(GITHUB));
      return { plugin: structuredClone(PACK) };
    },
    "plugin.remove": (params) => {
      calls.push({ method: "plugin.remove", params });
      plugins.splice(0, plugins.length, ...plugins.filter((p) => p.id !== params.plugin));
      return {};
    },
    "connector.list": () => ({
      connectors: [
        { id: "desk.github", instances: structuredClone(setup.accounts ?? []), resources: [] },
      ],
    }),
  };
  const bridge = new BridgeClient(browserStub(handlers));
  const host = document.createElement("div");
  document.body.append(host);
  const card = createCard(host);
  const commands = {
    run: async (id: string, args?: unknown) => {
      ran.push(args === undefined ? { id } : { id, args });
      if (id === "desk.profiles.list") return { active, profiles: [] };
      if (id === "desk.profiles.switch") active = (args as { id: string }).id;
      // Where the card stands when the token form opens: it must be applied by then.
      if (id === "desk.connectors.open")
        ran.push({ id: "card", args: host.querySelector(".proposal")?.getAttribute("data-state") });
      if (id === "desk.palette.pick" && setup.pick) return setup.pick();
      return {};
    },
    has: (id: string) => id !== "desk.palette.pick" || setup.pick !== undefined,
  };
  const notes: string[] = [];
  const deps = { bridge, commands, card, notify: (n: { title: string }) => notes.push(n.title) };
  // The commands Apply and Undo ran, without the reads.
  const acts = () => ran.filter((r) => r.id !== "desk.profiles.list");
  return { deps, calls, ran, acts, host, notes, active: () => active };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const press = async (host: HTMLElement, selector: string) => {
  for (let i = 0; i < 20 && !host.querySelector(selector); i++) await tick();
  host.querySelector<HTMLButtonElement>(selector)?.click();
};
const apply = (host: HTMLElement) => press(host, '[data-choice="apply"]');
const on = (plugin: string, enabled: boolean) => ({
  method: "plugin.setEnabled",
  params: { plugin, enabled, scope: PLUGINS },
});

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

  it("previews what it brings; Apply turns it on, lays it out and puts the token form in front", async () => {
    const { deps, calls, acts, host } = desk({ installed: [PACK, GITHUB] });
    const done = proposePack(deps, "github");
    await apply(host);
    const card = host.querySelector('[data-proposal="pack"]');
    expect(card?.textContent).toContain("GitHub");
    expect(card?.querySelector('[data-choice="retry"]'), "nothing to try again").toBeNull();
    expect(await done).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(host.textContent).toContain("Builder morning");
    expect(calls).toEqual([on("desk.pack-github", true), on("desk.github", true)]);
    // The board would cover the token form: it waits on the card, and the form opens last, once
    // the card says what was applied, so closing the form gives the focus back to the card.
    expect(acts()).toEqual([
      { id: "desk.profiles.switch", args: { id: "builder-morning" } },
      { id: "desk.connectors.open", args: { connector: "desk.github" } },
      { id: "card", args: "applied" },
    ]);
    expect(host.querySelector(".proposal-note")?.textContent).toBe(
      "GitHub is on. Put your token in Settings, Connections, then open GitHub board here.",
    );
    await press(host, '[data-action="next"]');
    expect(acts().at(-1)).toEqual({ id: "desk.pack-github.board" });
  });

  it("opens what it opens at once when its connector has an account, with no token form", async () => {
    const { deps, acts, host } = desk({ installed: [PACK, GITHUB], accounts: [ACCOUNT] });
    const done = proposePack(deps, "github");
    await apply(host);
    expect(await done).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(acts()).toEqual([
      { id: "desk.profiles.switch", args: { id: "builder-morning" } },
      { id: "desk.pack-github.board" },
    ]);
    expect(host.querySelector('[data-action="next"]')).toBeNull();
    expect(host.querySelector(".proposal-note")?.textContent).toBe("GitHub is set up.");
  });

  it("installs a pack the desk lacks from the market first", async () => {
    const { deps, calls, host } = desk({ installed: [], market: [LISTING] });
    const done = proposePack(deps, "github");
    await apply(host);
    expect(await done).toEqual({ status: "applied", id: "desk.pack-github" });
    expect(calls[0]).toEqual({
      method: "plugin.install",
      params: {
        id: "desk.pack-github",
        market: LISTING.market,
        accept: LISTING.entry.permissions,
        scope: PLUGINS,
      },
    });
  });

  it("says so when no pack serves the service", async () => {
    const { deps, notes } = desk({ installed: [GITHUB] });
    expect(await proposePack(deps, "jira")).toEqual({ status: "none" });
    expect(notes[0]).toContain("jira");
  });
});

describe("Undo of a pack", () => {
  it("switches back to the profile in force before, then turns off what Apply turned on", async () => {
    const { deps, calls, acts, host, notes, active } = desk({ installed: [PACK, GITHUB] });
    const done = proposePack(deps, "github");
    await apply(host);
    await done;
    calls.length = 0;
    const before = acts().length;
    await press(host, '[data-action="undo"]');
    for (let i = 0; i < 20 && host.querySelector(".proposal"); i++) await tick();
    // The profile first: the pack contributes it, and a pack turned off takes it away.
    expect(acts().slice(before)).toEqual([{ id: "desk.profiles.switch", args: { id: "default" } }]);
    expect(active()).toBe("default");
    expect(calls).toEqual([on("desk.github", false), on("desk.pack-github", false)]);
    expect(host.querySelector(".proposal"), "the card goes").toBeNull();
    expect(notes.at(-1)).toBe("Took back the GitHub pack");
  });

  it("leaves what was on before Apply on, and the profile that was in force", async () => {
    const enabled = [PACK, GITHUB].map((p) => ({ ...p, enabled: true }));
    const { deps, calls, acts, host, active } = desk({
      installed: enabled,
      active: "builder-morning",
    });
    const done = proposePack(deps, "github");
    await apply(host);
    await done;
    calls.length = 0;
    const before = acts().length;
    await press(host, '[data-action="undo"]');
    for (let i = 0; i < 20 && host.querySelector(".proposal"); i++) await tick();
    expect(acts().slice(before)).toEqual([]);
    expect(calls).toEqual([]);
    expect(active()).toBe("builder-morning");
  });

  it("removes a pack Apply installed from a market", async () => {
    const { deps, calls, host } = desk({ installed: [], market: [LISTING] });
    const done = proposePack(deps, "github");
    await apply(host);
    await done;
    calls.length = 0;
    await press(host, '[data-action="undo"]');
    for (let i = 0; i < 20 && host.querySelector(".proposal"); i++) await tick();
    expect(calls.at(-1)).toEqual({
      method: "plugin.remove",
      params: { plugin: "desk.pack-github", scope: PLUGINS },
    });
  });
});

describe("desk.pack.setup", () => {
  it("with no service, asks which with the packs on the desk, and proposes the one picked", async () => {
    const { deps, ran, host } = desk({ installed: [PACK, GITHUB], pick: () => "github" });
    expect(await setUpPack(deps, {})).toEqual({ status: "asking" });
    for (let i = 0; i < 20 && !host.querySelector(".proposal"); i++) await tick();
    expect(ran.find((r) => r.id === "desk.palette.pick")?.args).toEqual({
      title: "Set up a service",
      placeholder: "A service, such as GitHub",
      items: [{ id: "github", label: "GitHub", detail: "Your GitHub work set up in one go." }],
      free: true,
    });
    expect(host.querySelector('[data-proposal="pack"]')?.textContent).toContain("GitHub pack");
  });

  it("takes a sentence typed in the pick as one said to Eris", async () => {
    const { deps, host } = desk({ installed: [PACK, GITHUB], pick: () => "Set up GitHub" });
    await setUpPack(deps, undefined);
    for (let i = 0; i < 20 && !host.querySelector(".proposal"); i++) await tick();
    expect(host.querySelector('[data-proposal="pack"]')).not.toBeNull();
  });

  it("does nothing when the person backs out of the pick", async () => {
    const cancelled = Object.assign(new Error("nothing was picked"), { code: "cancelled" });
    const { deps, host, notes } = desk({
      installed: [PACK, GITHUB],
      pick: () => Promise.reject(cancelled),
    });
    await setUpPack(deps, {});
    for (let i = 0; i < 5; i++) await tick();
    expect(host.querySelector(".proposal")).toBeNull();
    expect(notes).toEqual([]);
  });

  it("without the palette, says in words how to name a service", () => {
    const { deps } = desk({ installed: [PACK, GITHUB] });
    expect(() => setUpPack(deps, {})).toThrow(
      "Say which service to set up, as in “Set up GitHub”.",
    );
  });

  it("with a service, proposes its pack at once", async () => {
    const { deps, host } = desk({ installed: [PACK, GITHUB] });
    const done = setUpPack(deps, { service: " GitHub " });
    await press(host, '[data-choice="discard"]');
    expect(await done).toEqual({ status: "discarded" });
  });
});
