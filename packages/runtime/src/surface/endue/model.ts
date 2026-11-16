/**
 * What an endue agent's or space's window shows, without a DOM (ADR 0129). The front of the card
 * follows endue.ai's agent card and space list: who it is, what it is for, and how it is right now.
 * A space's back, Studio, is the status: every fact as a label and a value, read from studio.*
 * only. An agent's back is its Studio board (board-model.ts, ADR 0232).
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioConversation,
  StudioSpace,
  StudioSpacesGetResult,
  StudioSpaceWorkStatus,
} from "@endue-ai/bridge";
import type { Lang } from "../../shell/copy";
import { type EnduePresence, enduePresence, hexColour, type Read } from "../../system/endue-ids";
import { ago } from "../local-agent/model";
import { type EndueKey, endueText } from "./copy";

/** One fact of Studio: a label, its value, and how it reads. */
export interface Fact {
  key: string;
  label: string;
  value: string;
  tone?: "good" | "attention" | "muted";
}

export interface AgentFront {
  name: string;
  handle: string;
  role: string;
  description: string;
  presence: EnduePresence;
  presenceLabel: string;
  initial: string;
  colour?: string;
  chips: string[];
}

export interface SpaceMember {
  agentId: string;
  name: string;
  initial: string;
  colour?: string;
  /** Its seat in words: front, runs it, takes part; and its role there. */
  seat: string;
  role: string;
  /** One of the person's own agents, whose window can open. */
  own: boolean;
}

export interface SpaceFront {
  name: string;
  glyph: string;
  colour?: string;
  goal: string;
  frontDesk: string;
  members: SpaceMember[];
  chips: { text: string; tone?: "attention" }[];
  latest: string;
}

/** A line of a list on the back: a piece of work or a result, a room. */
export interface Line {
  id: string;
  title: string;
  meta: string;
  tone?: "attention" | "good";
}

export const initialOf = (name: string) => [...name.trim()][0]?.toUpperCase() ?? "?";

const PRESENCE: Record<EnduePresence, EndueKey> = {
  working: "working",
  waiting: "waiting",
  online: "online",
  paused: "paused",
  offline: "offline",
};

export const presenceText = (lang: Lang, presence: EnduePresence) =>
  endueText(lang, PRESENCE[presence]);

/** The shell's dot for a presence: working and waiting stand out, the rest are quiet. */
export function dotOf(presence: string): string {
  if (presence === "working") return "dot-active";
  if (presence === "waiting") return "dot-attention";
  if (presence === "online") return "dot-success";
  return "dot-idle";
}

/** A day as people read it: 2026. 11. 9. or Nov 9, 2026. */
function day(lang: Lang, at: string | undefined): string {
  const time = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(time)) return "";
  const locale = lang === "ko" ? "ko-KR" : "en-US";
  return new Date(time).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** The short model id: anthropic/claude-sonnet-4.5 reads claude-sonnet-4.5. */
export const shortModel = (model: string | undefined) =>
  model ? (model.split("/").at(-1) ?? model) : "";

const ready = <T>(read: Read<T> | undefined) => (read?.state === "ready" ? read.value : undefined);

export function agentFront(
  lang: Lang,
  agent: StudioAgent,
  read: Read<StudioAgentsFacetsResult> | undefined,
  conversations: readonly StudioConversation[],
): AgentFront {
  const facets = ready(read);
  const presence = enduePresence(agent, conversations);
  const skills = facets?.skills.filter((s) => s.enabled).length;
  const connectors = facets?.connectors.filter((c) => c.enabled).length;
  const model = shortModel(facets?.settings?.model.default);
  return {
    name: agent.name || agent.slug,
    handle: `@${agent.slug}`,
    role: facets?.identity?.role ?? "",
    description: facets?.identity?.description?.trim() ?? "",
    presence,
    presenceLabel: presenceText(lang, presence),
    initial: initialOf(agent.name || agent.slug),
    ...(hexColour(agent.personalColor) ? { colour: hexColour(agent.personalColor) } : {}),
    chips: [
      skills ? endueText(lang, "skillsChip", { n: skills }) : "",
      connectors ? endueText(lang, "connectorsChip", { n: connectors }) : "",
      model,
    ].filter(Boolean),
  };
}

/** The people's names for a space's agents: the person's own by name, anyone else's as such. */
function membersOf(
  lang: Lang,
  detail: StudioSpacesGetResult | undefined,
  agents: readonly StudioAgent[],
): SpaceMember[] {
  return (detail?.agents ?? []).map((member) => {
    const mine = agents.find((a) => a.id === member.agentId);
    const name = mine?.name || endueText(lang, "someoneElse");
    const seat = member.front ? "front" : member.permission;
    return {
      agentId: member.agentId,
      name,
      initial: mine ? initialOf(name) : "?",
      ...(hexColour(mine?.personalColor) ? { colour: hexColour(mine?.personalColor) } : {}),
      seat: endueText(lang, seat),
      role: member.roleKey,
      own: Boolean(mine),
    };
  });
}

export function spaceFront(
  lang: Lang,
  space: StudioSpace,
  read: Read<StudioSpacesGetResult> | undefined,
  agents: readonly StudioAgent[],
  now: number,
): SpaceFront {
  const t = (key: EndueKey, vars?: Record<string, string | number>) => endueText(lang, key, vars);
  const detail = ready(read);
  const counts = detail?.counts ?? {
    activeWorkItems: space.summary?.activeWorkItems ?? 0,
    openAttentionItems: space.summary?.openAttentionItems ?? 0,
  };
  const members = membersOf(lang, detail, agents);
  const front = agents.find((a) => a.id === space.frontAgentId);
  const latest = space.summary?.latestResult ?? detail?.results[0];
  const chips: SpaceFront["chips"] = [];
  if (members.length) chips.push({ text: t("agentsChip", { n: members.length }) });
  if (counts.activeWorkItems) chips.push({ text: t("inProgress", { n: counts.activeWorkItems }) });
  if (counts.openAttentionItems)
    chips.push({ text: t("needsYou", { n: counts.openAttentionItems }), tone: "attention" });
  return {
    name: space.name || space.key,
    glyph: space.avatarGlyph || initialOf(space.name || space.key),
    ...(hexColour(space.avatarColor) ? { colour: hexColour(space.avatarColor) } : {}),
    goal: space.goal || space.description || "",
    frontDesk: front ? t("frontDesk", { name: front.name }) : "",
    members,
    chips,
    latest: latest
      ? [t("latest", { title: latest.title }), ago(lang, latest.updatedAt, now)]
          .filter(Boolean)
          .join(" · ")
      : "",
  };
}

const WORK_TONE: Partial<Record<StudioSpaceWorkStatus, Line["tone"]>> = {
  needs_you: "attention",
  failed: "attention",
  done: "good",
};

/** Studio for a space: its facts, then the work going on, the newest results and the rooms. */
export function spaceStudio(
  lang: Lang,
  space: StudioSpace,
  read: Read<StudioSpacesGetResult> | undefined,
  agents: readonly StudioAgent[],
  now: number,
): {
  facts: Fact[];
  members: SpaceMember[];
  work: Line[];
  results: Line[];
  rooms: Line[];
  problems: string[];
} {
  const t = (key: EndueKey, vars?: Record<string, string | number>) => endueText(lang, key, vars);
  const detail = ready(read);
  const counts = detail?.counts;
  const unknown = read?.state === "loading" ? t("reading") : t("notAnswered");
  const rooms = detail?.rooms ?? [];
  const unread = rooms.reduce((n, r) => n + r.unreadCount, 0);
  const live = rooms.filter((r) => r.discussing).length;
  const last = space.summary?.lastActivityAt ?? space.updatedAt;
  const facts: Fact[] = [
    {
      key: "status",
      label: t("status"),
      value: t(space.status === "archived" ? "statusArchived" : "statusSpaceActive"),
      tone: space.status === "archived" ? "muted" : "good",
    },
    {
      key: "work",
      label: t("workInProgress"),
      value: counts ? String(counts.activeWorkItems) : unknown,
    },
    {
      key: "attention",
      label: t("waitingForYou"),
      value: counts ? String(counts.openAttentionItems) : unknown,
      ...(counts?.openAttentionItems ? { tone: "attention" as const } : {}),
    },
    { key: "results", label: t("results"), value: counts ? String(counts.results) : unknown },
    {
      key: "agents",
      label: t("agents"),
      value: detail ? t("count", { n: detail.agents.length }) : unknown,
    },
    {
      key: "rooms",
      label: t("rooms"),
      value: detail ? t("roomsLine", { n: rooms.length, unread, live }) : unknown,
      ...(unread ? { tone: "attention" as const } : {}),
    },
    { key: "last", label: t("lastActivity"), value: ago(lang, last, now) || t("none") },
    { key: "created", label: t("created"), value: day(lang, space.createdAt) },
  ];
  const parts: Record<string, EndueKey> = { overview: "partOverview", rooms: "partRooms" };
  return {
    facts,
    members: membersOf(lang, detail, agents),
    work: (detail?.work ?? []).map((w) => ({
      id: w.id,
      title: w.title,
      meta: [t(w.status === "paused" ? "paused" : w.status), ago(lang, w.updatedAt, now)]
        .filter(Boolean)
        .join(" · "),
      ...(WORK_TONE[w.status] ? { tone: WORK_TONE[w.status] } : {}),
    })),
    results: (detail?.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      meta: [r.kind, ago(lang, r.updatedAt, now)].filter(Boolean).join(" · "),
    })),
    rooms: rooms.map((r) => ({
      id: r.id,
      title: r.name,
      meta: [
        r.topic,
        r.discussing ? t("discussing") : "",
        r.unreadCount ? t("unread", { n: r.unreadCount }) : "",
      ]
        .filter(Boolean)
        .join(" · "),
      ...(r.unreadCount || r.threads?.needsYou ? { tone: "attention" as const } : {}),
    })),
    problems: (detail?.problems ?? []).map((p) =>
      t("partFailed", { part: t(parts[p.part] ?? "partOverview"), why: p.message }),
    ),
  };
}
