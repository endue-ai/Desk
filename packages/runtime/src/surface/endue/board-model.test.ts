import { readFileSync } from "node:fs";
import type { StudioAgent, StudioAgentsFacetsResult } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { connectorState, MAX_CONNECTORS, studioBoard } from "./board-model";

const at = "2026-11-08T09:00:00Z";
const agent: StudioAgent = {
  id: "ag_1",
  slug: "miso",
  name: "Miso",
  status: "active",
  description: "Keeps my mail",
  liveEnabled: true,
  mcpEnabled: false,
  createdAt: at,
  updatedAt: at,
};
const connector = (n: number, extra: object = {}) => ({
  id: `b${n}`,
  connectionId: `c${n}`,
  enabled: true,
  name: `Tool ${n}`,
  type: "gmail",
  status: "active",
  ...extra,
});
const facets: StudioAgentsFacetsResult = {
  agent,
  identity: { name: "Miso", role: "Mail", languages: ["ko"] },
  settings: {
    visibility: "private",
    model: { default: "x-ai/grok-4.3" },
    disabledToolGroups: ["image"],
    availableToolGroups: ["web_fetch", "artifact", "image", "brand_new"],
  },
  prompt: { rev: 2, content: "\n  Answer briefly.\nIn Korean.", source: "manual", createdAt: at },
  revisions: [],
  skills: [
    { id: "s1", skillId: "k1", name: "Document (Markdown)", enabled: true },
    { id: "s2", skillId: "k2", name: "Off", enabled: false },
  ],
  connectors: [
    connector(1),
    connector(2, { status: "expired" }),
    connector(3, { enabled: false, status: "expired" }),
  ],
  traits: [
    { key: "personality", enabled: true },
    { key: "dream", enabled: false },
  ],
  channels: [],
  apiKeys: [],
  devices: [],
  memory: { memories: 0, rules: 0, more: false },
  outputs: { count: 0 },
  theme: {},
  problems: [],
};
const ready = { state: "ready" as const, value: facets };
const row = <R extends { id: string }>(rows: R[], id: string) => rows.find((r) => r.id === id);
const sentence = (board: ReturnType<typeof studioBoard>) =>
  board.hub.sentence.map((s) => s.text).join("");

describe("an endue agent's Studio board, without a DOM (ADR 0232)", () => {
  it("lists the ways in in endue.ai's order, each in the state the desk knows", () => {
    const board = studioBoard("en", agent, ready, []);
    expect(board.inbound.map((r) => [r.id, r.state, r.meta])).toEqual([
      ["console", "on", undefined],
      ["channel", "off", "None"],
      ["live", "on", "On"],
      ["api", "off", "0 keys"],
      ["mcp", "off", "Off"],
    ]);
    // Not read yet: on its way, and neither on nor off.
    const loading = studioBoard("en", agent, { state: "loading" }, []);
    expect(row(loading.inbound, "channel")).toMatchObject({ state: "unknown", meta: "…" });
    expect(row(loading.inbound, "api")).toMatchObject({ state: "unknown", meta: "…" });
    expect(row(board.inbound, "live")?.sub).toBe("endue.live/@miso");
    // What endue AI does not say is not guessed: no On, no Off.
    const silent = studioBoard("en", { ...agent, liveEnabled: undefined }, ready, []);
    expect(row(silent.inbound, "live")).toMatchObject({
      state: "unknown",
      sub: "Public on endue.live",
    });
    expect(row(silent.inbound, "live")?.meta).toBeUndefined();
  });

  it("draws a connector's line off while it is turned off, and a problem once its sign-in expired", () => {
    expect(connectorState({ enabled: true, status: "active" })).toBe("on");
    expect(connectorState({ enabled: true, status: "expired" })).toBe("bad");
    expect(connectorState({ enabled: false, status: "expired" })).toBe("off");
    const board = studioBoard("en", agent, ready, []);
    expect(board.outbound.map((r) => [r.id, r.state, r.sub])).toEqual([
      ["connector-b1", "on", "Active"],
      ["connector-b2", "bad", "Needs attention"],
      ["connector-b3", "off", "Turned off"],
      ["devices", "off", "Computer · Chrome · Android"],
      ["outputs", "on", "No outputs yet"],
    ]);
    const loading = studioBoard("en", agent, { state: "loading" }, []);
    expect(loading.outbound.map((r) => [r.id, r.state, r.sub])).toEqual([
      ["devices", "unknown", "Computer · Chrome · Android"],
      ["outputs", "unknown", "What the agent made"],
    ]);
    expect(row(board.outbound, "connector-b1")?.mono).toBe("TO");
  });

  it("shows six connectors and leaves the rest to one line", () => {
    const many = { ...facets, connectors: Array.from({ length: 9 }, (_, i) => connector(i)) };
    const board = studioBoard("en", agent, { state: "ready", value: many }, []);
    expect(board.outbound.filter((r) => r.id.startsWith("connector-"))).toHaveLength(
      MAX_CONNECTORS,
    );
    expect(board.connectors).toEqual({ count: 9, more: 3 });
  });

  it("says what the agent does from what is on", () => {
    const board = studioBoard("en", agent, ready, []);
    expect(sentence(board)).toBe(
      "Takes requests from Console chat · Live, handles them with 1 skills and 3 built-in tools, " +
        "and leaves results in Tool 1 · Outputs. Needs reconnecting: Tool 2",
    );
    expect(board.hub.sentence.filter((s) => s.tone === "warn")).toHaveLength(1);
    const ko = studioBoard("ko", { ...agent, mcpEnabled: true }, undefined, []);
    expect(sentence(ko)).toBe(
      "콘솔 채팅 · 라이브 · MCP 에서 요청을 받아 대화만으로 처리하고, 결과를 결과물에 남겨요.",
    );
  });

  it("fills the agent's sheet from the facets: the prompt's first line, traits, model, skills, tools", () => {
    const { hub } = studioBoard("en", agent, ready, []);
    expect([hub.name, hub.handle, hub.description]).toEqual([
      "Miso",
      "@miso · Mail",
      "Keeps my mail",
    ]);
    const values = Object.fromEntries(hub.identity.map((r) => [r.section, r.value]));
    expect(values.prompt).toBe("“Answer briefly.”");
    expect(values.model).toBe("grok-4.3");
    expect([values.memory, values.wallpaper]).toEqual(["None yet", "None — pick one"]);
    const traits = hub.identity.find((r) => r.section === "trait")?.badges ?? [];
    expect(traits.map((b) => [b.key, b.on])).toEqual([
      ["personality", true],
      ["self_evolving", false],
      ["dream", false],
      ["self_config", false],
    ]);
    expect(hub.skills).toEqual({ label: "Skills 1", chips: ["Document (Markdown)"], more: 0 });
    // endue.ai's order; a group the desk has no word for keeps its place under its own name.
    expect(hub.tools.badges?.map((b) => [b.key, b.label, b.on])).toEqual([
      ["artifact", "Outputs", true],
      ["web_fetch", "Web Fetch", true],
      ["image", "Image generation", false],
      ["brand_new", "brand_new", true],
    ]);
  });

  it("says a facet is on its way, or was not answered, instead of looking empty", () => {
    const loading = studioBoard("en", agent, { state: "loading" }, []);
    expect(loading.hub.identity.find((r) => r.section === "prompt")?.value).toBe("…");
    expect(loading.hub.tools.badges).toBeUndefined();
    const failed = {
      ...facets,
      settings: undefined,
      problems: [{ facet: "settings" as const, code: "offline" as const, message: "down" }],
    };
    const board = studioBoard("en", agent, { state: "ready", value: failed }, []);
    expect(board.hub.identity.find((r) => r.section === "model")).toMatchObject({
      value: "—",
      muted: true,
    });
    expect(board.hub.tools.value).toBe("—");
  });
});

// Issue 352: connectors and skills read as the other facets do. The canonical vector, with both
// facets refused, draws "—" and no count; while the read is on its way, "…".
describe("an unread connectors or skills facet (issue 352)", () => {
  const vector = JSON.parse(
    readFileSync(
      new URL(
        "../../../../../specs/bridge/v0/vectors/valid/studio-agents-facets-result.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).instance as StudioAgentsFacetsResult;

  it("is drawn as not read, with no count, failed or still loading", () => {
    const failed: StudioAgentsFacetsResult = {
      ...vector,
      connectors: [],
      skills: [],
      problems: [
        { facet: "connectors", code: "offline", message: "down" },
        { facet: "skills", code: "offline", message: "down" },
      ],
    };
    for (const [read, mark] of [
      [{ state: "ready" as const, value: failed }, "—"],
      [{ state: "loading" as const }, "…"],
    ] as const) {
      const board = studioBoard("en", vector.agent ?? agent, read, []);
      expect(board.connectors).toMatchObject({ read: false, count: 0 });
      expect(board.hub.skills).toMatchObject({ read: false, value: mark, chips: [] });
      expect(board.hub.skills.label).toBe("Skills");
      expect(board.outbound.filter((r) => r.id.startsWith("connector-"))).toEqual([]);
    }
  });

  it("still says none when the facet was read and holds none", () => {
    const none = { ...vector, connectors: [], skills: [], problems: [] };
    const board = studioBoard("en", vector.agent ?? agent, { state: "ready", value: none }, []);
    expect(board.connectors).toMatchObject({ read: true, count: 0 });
    expect(board.hub.skills).toMatchObject({ read: true, label: "Skills 0", chips: [] });
  });
});

describe("the rows the board reads beyond Studio's facets (ADR 0232)", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const full: StudioAgentsFacetsResult = {
    ...facets,
    channels: [
      { id: "cp_1", provider: "slack", name: "Acme", status: "active" },
      { id: "cp_2", provider: "discord", status: "pending" },
      { id: "cp_3", provider: "kakao", name: "Shop", status: "revoked" },
    ],
    apiKeys: [
      { id: "k1", name: "Shop", expiresAt: "2027-01-01T00:00:00Z" },
      { id: "k2", name: "Soon", expiresAt: "2026-11-10T00:00:00Z" },
      { id: "k3", name: "Old", expiresAt: "2026-11-01T00:00:00Z" },
    ],
    devices: [
      { id: "d1", kind: "computer", name: "My Mac", workspace: false },
      { id: "w1", kind: "chrome", name: "Research", workspace: true },
      { id: "d2", kind: "computer", name: "Linux box", workspace: false },
    ],
    memory: { memories: 12, rules: 3, more: true },
    outputs: { count: 7, latestAt: "2026-11-08T11:57:00Z" },
    theme: { wallpaper: { source: "builtin", id: "constellation" } },
  };
  const board = studioBoard("en", agent, { state: "ready", value: full }, [], now);

  it("lists the channels and the keys made for the agent, each in how it stands", () => {
    expect(row(board.inbound, "channel")).toMatchObject({
      state: "on",
      sub: "Acme · Discord +1",
      meta: "3",
    });
    expect(row(board.inbound, "channel")?.body?.items?.map((i) => i.label)).toEqual([
      "Acme · Active",
      "Discord · Inactive",
      "Shop · Inactive",
    ]);
    expect(row(board.inbound, "api")).toMatchObject({ state: "on", meta: "3 keys" });
    expect(row(board.inbound, "api")?.body?.items?.map((i) => [i.label, i.tone])).toEqual([
      ["Shop", undefined],
      ["Soon · Expiring soon", "warn"],
      ["Old · Expired", "muted"],
    ]);
    // Only expired keys: the way in is off.
    const old = { ...full, apiKeys: [full.apiKeys[2]].filter((k) => k !== undefined) };
    const off = studioBoard("en", agent, { state: "ready", value: old }, [], now);
    expect(row(off.inbound, "api")?.state).toBe("off");
  });

  it("counts the devices by kind and says what the agent made, and when", () => {
    expect(row(board.outbound, "devices")).toMatchObject({
      state: "on",
      sub: "Computer · Chrome",
      meta: "3",
    });
    expect(row(board.outbound, "outputs")?.sub).toBe("7 outputs · last 3 min ago");
    const values = Object.fromEntries(board.hub.identity.map((r) => [r.section, r.value]));
    expect(values.memory).toBe("12+ memories · 3 rules");
    expect(values.wallpaper).toBe("Constellation · Built-in");
    const ko = studioBoard("ko", agent, { state: "ready", value: full }, [], now);
    const kv = Object.fromEntries(ko.hub.identity.map((r) => [r.section, r.value]));
    expect([kv.memory, kv.wallpaper]).toEqual(["기억 12+ · 규칙 3", "별자리 · 기본 제공"]);
  });

  it("names a gallery wallpaper with its author, and the person's own by its name", () => {
    const wallpaper = (theme: StudioAgentsFacetsResult["theme"]) => {
      const b = studioBoard("en", agent, { state: "ready", value: { ...full, theme } }, [], now);
      return b.hub.identity.find((r) => r.section === "wallpaper")?.value;
    };
    expect(
      wallpaper({ wallpaper: { source: "gallery", id: "g1", name: "Dusk", author: "Mina" } }),
    ).toBe("Dusk · by Mina");
    expect(wallpaper({ wallpaper: { source: "mine", id: "w9", name: "Sea" } })).toBe("Sea · Mine");
  });

  it("takes the active channels and a live key into what the agent does", () => {
    expect(sentence(board)).toMatch(/^Takes requests from Console chat · Acme · Live · API,/);
  });

  it("leaves a row endue AI did not answer for unread, not empty", () => {
    const failed = {
      ...full,
      channels: [],
      memory: undefined,
      problems: [
        { facet: "channels" as const, code: "offline" as const, message: "down" },
        { facet: "memory" as const, code: "offline" as const, message: "down" },
      ],
    };
    const b = studioBoard("en", agent, { state: "ready", value: failed }, [], now);
    expect(row(b.inbound, "channel")).toMatchObject({ state: "unknown", meta: "—" });
    expect(row(b.inbound, "channel")?.body?.text).toEqual(["See it on endue.ai"]);
    expect(b.hub.identity.find((r) => r.section === "memory")).toMatchObject({
      value: "—",
      muted: true,
    });
  });
});
