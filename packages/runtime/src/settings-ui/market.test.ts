// @vitest-environment jsdom
// Settings, Market (ADR 0107): every kind the markets offer in one list, verified or not, the
// permissions an install adds shown and asked before it runs, code that is not verified not
// installable, and remove for what the market installed. The bridge answers as the core does.
import {
  BridgeClient,
  browserStub,
  type MarketListing,
  type Permission,
  type StubHandlers,
} from "@endue-ai/bridge";
import { afterEach, describe, expect, it } from "vitest";
import { mountMarket } from "./market";

const ENDUE = "https://raw.githubusercontent.com/endue-ai/Desk/main/market/views/index.json";
const ACME = "https://market.acme.test/index.json";
const READ: Permission = { permission: "data:read", kinds: ["task"] };
const FETCH: Permission = { permission: "net:fetch", hosts: ["api.acme.test"] };

function listing(
  id: string,
  kind: MarketListing["entry"]["kind"],
  market: string,
  more: Partial<MarketListing> = {},
): MarketListing {
  return {
    market,
    verified: market === ENDUE,
    state: "available",
    added: [],
    entry: {
      id,
      kind,
      name: id.split(".")[1] ?? id,
      version: "1.0.0",
      publisher: market === ENDUE ? "Team endue" : "Acme",
      license: "CC0-1.0",
      url: `${id}.desk-plugin`,
      sha256: "0".repeat(64),
      size: 100,
    },
    ...more,
  };
}

function mount() {
  const entries = [
    listing("market.week-ahead", "view", ENDUE),
    listing("acme.board", "view", ACME, { added: [READ] }),
    listing("acme.tracker", "plugin", ACME, { added: [FETCH] }),
    listing("market.lagoon", "theme", ENDUE, { state: "installed", installed: "1.0.0" }),
  ];
  const calls: Array<{ method: string; params: unknown }> = [];
  const handlers: StubHandlers = {
    "market.list": () => ({ entries: structuredClone(entries), problems: [] }),
    "plugin.install": (params) => {
      calls.push({ method: "plugin.install", params });
      const found = entries.find((e) => e.entry.id === params.id);
      if (found) Object.assign(found, { state: "installed", installed: "1.0.0", added: [] });
      return {
        plugin: { id: params.id, status: "ready", enabled: true, builtIn: false, revision: 1 },
      };
    },
    "plugin.remove": (params) => {
      calls.push({ method: "plugin.remove", params });
      const found = entries.find((e) => e.entry.id === params.plugin);
      if (found) Object.assign(found, { state: "available", installed: undefined });
      return {};
    },
  };
  const bridge = new BridgeClient(browserStub(handlers));
  const panel = mountMarket({ bridge, language: "en" });
  document.body.append(panel.el);
  return { panel, calls };
}

const card = (el: HTMLElement, id: string) => {
  const found = el.querySelector<HTMLElement>(`[data-entry="${id}"]`);
  if (!found) throw new Error(`no card for ${id}`);
  return found;
};
const button = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === label);

afterEach(() => {
  document.body.replaceChildren();
});

describe("Settings, Market", () => {
  it("lists every kind in its group, verified or not", async () => {
    const { panel } = mount();
    await panel.ready;
    const groups = [...panel.el.querySelectorAll("section[data-kind] h2")].map(
      (h) => h.textContent,
    );
    expect(groups).toEqual(["Views", "Plugins", "Themes"]);
    expect(card(panel.el, "market.week-ahead").textContent).toContain("Verified");
    expect(card(panel.el, "acme.board").textContent).toContain("Not verified");
    expect(card(panel.el, "market.lagoon").textContent).toContain("Installed 1.0.0");
    const tracker = card(panel.el, "acme.tracker");
    expect(button(tracker, "Install")?.disabled, "code that is not verified").toBe(true);
    panel.dispose();
  });

  it("installs at once when it adds no permission", async () => {
    const { panel, calls } = mount();
    await panel.ready;
    button(card(panel.el, "market.week-ahead"), "Install")?.click();
    await panel.idle();
    expect(calls).toEqual([
      {
        method: "plugin.install",
        params: {
          id: "market.week-ahead",
          market: ENDUE,
          accept: [],
          scope: { permission: "plugin:manage" },
        },
      },
    ]);
    expect(card(panel.el, "market.week-ahead").textContent).toContain("Installed 1.0.0");
    panel.dispose();
  });

  it("shows the permissions an install adds and asks before it runs", async () => {
    const { panel, calls } = mount();
    await panel.ready;
    const board = card(panel.el, "acme.board");
    button(board, "Install")?.click();
    await panel.idle();
    expect(calls).toEqual([]);
    const asked = card(panel.el, "acme.board").querySelector('[role="alertdialog"]');
    expect(asked?.textContent).toContain("Read your tasks");
    button(card(panel.el, "acme.board"), "Cancel")?.click();
    expect(card(panel.el, "acme.board").querySelector('[role="alertdialog"]')).toBeNull();
    button(card(panel.el, "acme.board"), "Install")?.click();
    button(card(panel.el, "acme.board"), "Allow and install")?.click();
    await panel.idle();
    expect(calls).toEqual([
      {
        method: "plugin.install",
        params: {
          id: "acme.board",
          market: ACME,
          accept: [READ],
          scope: { permission: "plugin:manage" },
        },
      },
    ]);
    panel.dispose();
  });

  it("removes what the market installed", async () => {
    const { panel, calls } = mount();
    await panel.ready;
    button(card(panel.el, "market.week-ahead"), "Install")?.click();
    await panel.idle();
    button(card(panel.el, "market.week-ahead"), "Remove")?.click();
    await panel.idle();
    expect(calls.at(-1)).toEqual({
      method: "plugin.remove",
      params: { plugin: "market.week-ahead", scope: { permission: "plugin:manage" } },
    });
    expect(button(card(panel.el, "market.week-ahead"), "Install")).toBeDefined();
    panel.dispose();
  });
});
