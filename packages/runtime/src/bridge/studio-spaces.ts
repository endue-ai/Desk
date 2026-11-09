/**
 * studio.spaces.* on the browser stub (ADR 0129): two of the person's spaces, made up for the
 * fixtures. Launch has Miso at the front, Scout and Mailie taking part, work going on, results and
 * two rooms; Reading club is quiet. studioHandlers mounts these beside the agents, behind the same
 * checks (studio:manage, signed in).
 */
import {
  StubError,
  type StubHandlers,
  type StudioSpace,
  type StudioSpacesGetResult,
} from "@endue-ai/bridge";
import { sampleAgentId } from "./studio-fixtures";

/** One space and what studio.spaces.get answers beside it. */
export interface StudioSpaceRecord {
  space: StudioSpace;
  detail: Omit<StudioSpacesGetResult, "space">;
}

const iso = (epoch: number, minutesAgo: number) =>
  new Date(epoch - minutesAgo * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const SP = (n: number) => `sp_sample${String(n).padStart(3, "0")}`;

export function sampleSpaces(epoch: number): StudioSpaceRecord[] {
  const at = (minutesAgo: number) => iso(epoch, minutesAgo);
  const launch: StudioSpaceRecord = {
    space: {
      id: SP(1),
      key: "launch",
      name: "Launch",
      description: "Everything for the autumn launch",
      goal: "Ship the launch page and its first mail",
      status: "active",
      frontAgentId: sampleAgentId(1),
      avatarColor: "#B6A3F5",
      avatarGlyph: "🚀",
      summary: {
        activeWorkItems: 2,
        openAttentionItems: 1,
        latestResult: { id: "res_sample1", title: "Launch page draft", updatedAt: at(30) },
        lastActivityAt: at(2),
      },
      createdAt: at(60 * 24 * 6),
      updatedAt: at(2),
    },
    detail: {
      counts: { activeWorkItems: 2, openAttentionItems: 1, results: 4 },
      agents: [
        { agentId: sampleAgentId(1), roleKey: "generalist", front: true, permission: "admin" },
        { agentId: sampleAgentId(3), roleKey: "analyst", front: false, permission: "participant" },
        { agentId: sampleAgentId(2), roleKey: "writer", front: false, permission: "participant" },
      ],
      work: [
        {
          id: "wi_sample1",
          title: "Write the first mail",
          status: "in_progress",
          updatedAt: at(2),
        },
        { id: "wi_sample2", title: "Pick the hero image", status: "needs_you", updatedAt: at(12) },
      ],
      results: [
        { id: "res_sample1", title: "Launch page draft", kind: "document", updatedAt: at(30) },
        { id: "res_sample2", title: "Competitor table", kind: "table", updatedAt: at(240) },
      ],
      rooms: [
        {
          id: "room_sample1",
          name: "Copy",
          topic: "The launch mail",
          unreadCount: 3,
          lastMessageAt: at(2),
          discussing: true,
          threads: { active: 1, needsYou: 1, unread: 2 },
        },
        {
          id: "room_sample2",
          name: "Research",
          unreadCount: 0,
          lastMessageAt: at(300),
          discussing: false,
        },
      ],
      problems: [],
    },
  };
  const reading: StudioSpaceRecord = {
    space: {
      id: SP(2),
      key: "reading",
      name: "Reading club",
      description: "Books we read together",
      status: "active",
      frontAgentId: sampleAgentId(3),
      summary: { activeWorkItems: 0, openAttentionItems: 0, lastActivityAt: at(60 * 24 * 3) },
      createdAt: at(60 * 24 * 20),
      updatedAt: at(60 * 24 * 3),
    },
    detail: {
      counts: { activeWorkItems: 0, openAttentionItems: 0, results: 1 },
      agents: [
        { agentId: sampleAgentId(3), roleKey: "generalist", front: true, permission: "admin" },
      ],
      work: [],
      results: [
        {
          id: "res_sample3",
          title: "Notes on the first book",
          kind: "document",
          updatedAt: at(60 * 24 * 3),
        },
      ],
      rooms: [],
      problems: [],
    },
  };
  return [launch, reading];
}

/** studio.spaces.list and studio.spaces.get over `spaces`, each call passing `gate` first. */
export function spaceHandlers(
  spaces: StudioSpaceRecord[],
  gate: (caller: string | undefined) => void,
): StubHandlers {
  return {
    "studio.spaces.list": ({ archived }, caller) => {
      gate(caller);
      const wanted = archived ? "archived" : "active";
      return {
        spaces: spaces
          .filter((s) => s.space.status === wanted)
          .map((s) => structuredClone(s.space)),
      };
    },
    "studio.spaces.get": ({ spaceId }, caller) => {
      gate(caller);
      const found = spaces.find((s) => s.space.id === spaceId);
      if (!found) throw new StubError("not_found", "Space not found");
      return structuredClone({ space: found.space, ...found.detail });
    },
  };
}
