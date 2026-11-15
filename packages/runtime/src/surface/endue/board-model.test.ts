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
      ["channel", "unknown", undefined],
      ["live", "on", "On"],
      ["api", "unknown", undefined],
      ["mcp", "off", "Off"],
    ]);
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
      ["devices", "unknown", "Computer · Chrome · Android"],
      ["outputs", "on", "What the agent made"],
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
    // Memory and the wallpaper are not read by the desk: they say where to look.
    expect([values.memory, values.wallpaper]).toEqual(["See it on endue.ai", "See it on endue.ai"]);
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
