import type { StudioAgent, StudioAgentsFacetsResult, StudioSpace } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { agentFront, agentStudio, spaceFront, spaceStudio } from "./model";

const at = "2026-11-08T09:00:00Z";
const now = Date.parse("2026-11-09T09:00:00Z");
const agent: StudioAgent = {
  id: "ag_1",
  slug: "miso",
  name: "Miso",
  status: "active",
  personalColor: "url(x)",
  createdAt: at,
  updatedAt: at,
};
const facets: StudioAgentsFacetsResult = {
  agent,
  identity: { name: "Miso", role: "Mail", languages: ["ko"] },
  revisions: [],
  skills: [
    { id: "b1", skillId: "s1", enabled: true },
    { id: "b2", skillId: "s2", enabled: false },
  ],
  connectors: [],
  traits: [],
  problems: [{ facet: "settings", code: "offline", message: "down" }],
};
const space: StudioSpace = {
  id: "sp_1",
  key: "launch",
  name: "Launch",
  status: "archived",
  avatarColor: "#B6A3F5",
  createdAt: at,
  updatedAt: at,
};

describe("the endue cards' model (ADR 0129)", () => {
  it("leaves a colour that is not #rrggbb out of the card", () => {
    expect(agentFront("en", agent, undefined, []).colour).toBeUndefined();
    expect(spaceFront("en", space, undefined, [], now).colour).toBe("#B6A3F5");
  });

  it("says which facet endue AI did not answer, and counts what it did", () => {
    const read = { state: "ready" as const, value: facets };
    const facts = Object.fromEntries(
      agentStudio("en", agent, read, [], now).map((f) => [f.key, f.value]),
    );
    expect(facts.model).toBe("endue AI did not answer");
    expect(facts.visibility).toBe("endue AI did not answer");
    expect(facts.skills).toBe("1 of 2 on");
    expect(facts.connectors).toBe("None");
    expect(facts.prompt).toBe("None");
    expect(facts.languages).toBe("ko");
    expect(facts.last).toBe("None");
    expect(agentFront("en", agent, read, []).chips).toEqual(["Skills · 1"]);
  });

  it("says reading while the facets are on their way", () => {
    const facts = agentStudio("en", agent, { state: "loading" }, [], now);
    expect(facts.find((f) => f.key === "model")?.value).toBe("Reading…");
  });

  it("names someone else's agent in a space as such, and opens only the person's own", () => {
    const read = {
      state: "ready" as const,
      value: {
        space,
        counts: { activeWorkItems: 0, openAttentionItems: 0, results: 0 },
        agents: [
          { agentId: "ag_1", roleKey: "writer", front: true, permission: "admin" as const },
          {
            agentId: "ag_theirs",
            roleKey: "analyst",
            front: false,
            permission: "participant" as const,
          },
        ],
        work: [],
        results: [],
        rooms: [],
        problems: [],
      },
    };
    const { members, facts } = spaceStudio("en", space, read, [agent], now);
    expect(members.map((m) => [m.name, m.seat, m.own])).toEqual([
      ["Miso", "Front", true],
      ["Someone else's agent", "Takes part", false],
    ]);
    expect(facts.find((f) => f.key === "status")).toMatchObject({
      value: "Archived",
      tone: "muted",
    });
  });
});
