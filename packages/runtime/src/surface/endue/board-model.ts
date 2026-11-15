/**
 * What an endue agent's Studio board shows, without a DOM (ADR 0232): the ways requests come in,
 * the agent's own sheet, and what it reaches, each row with the state its line is drawn in. It
 * reads the agent and its facets (studio.*) and nothing else. The outer columns are `board-rows`;
 * here is the sheet in the middle: who the agent is, what it remembers, how it is set up, what it
 * can use, and the sentence that says what it does. A facet not read is never guessed: it says so.
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioConversation,
  StudioWallpaper,
} from "@endue-ai/bridge";
import type { Lang } from "../../shell/copy";
import { type EnduePresence, enduePresence, type Read } from "../../system/endue-ids";
import {
  type BoardKey,
  boardText,
  type Capability,
  capability,
  isBoardKey,
  type Seg,
} from "./board-copy";
import {
  type BoardRow,
  connectorState,
  inboundRows,
  inputsOn,
  MAX_CONNECTORS,
  outboundRows,
  type RowFacts,
} from "./board-rows";
import { initialOf, presenceText, shortModel } from "./model";

export type { BoardRow, LineState, RowAction } from "./board-rows";
export { connectorState, MAX_CONNECTORS } from "./board-rows";

/** A trait or a group of built-in tools on the sheet: an icon, green while on. */
export interface Badge {
  key: string;
  label: string;
  on: boolean;
  icon: string;
}

/** A line of the agent's sheet: it opens its part of Studio. */
export interface SheetRow {
  section: string;
  label: string;
  value: string;
  muted?: boolean;
  badges?: Badge[];
  /** The value takes the whole line under the label (a row of icons). */
  stack?: boolean;
}

export interface Board {
  inbound: BoardRow[];
  outbound: BoardRow[];
  /** How many connectors there are in all, and how many the board leaves to "more". */
  connectors: { count: number; more: number };
  hub: {
    name: string;
    initial: string;
    handle: string;
    description: string;
    presence: EnduePresence;
    presenceLabel: string;
    sentence: Seg[];
    identity: SheetRow[];
    skills: { label: string; chips: string[]; more: number };
    tools: SheetRow;
  };
}

/** The skill chips the sheet shows. */
export const MAX_CHIPS = 6;

const TRAITS: [key: string, icon: string][] = [
  ["personality", "user"],
  ["self_evolving", "brain"],
  ["dream", "moon"],
  ["self_config", "settings"],
  ["autonomy", "compass"],
];

/** The groups of built-in tools in endue.ai's order, each under its icon. */
const TOOLS: [key: string, icon: string][] = [
  ["artifact", "box"],
  ["routine", "clock"],
  ["memory", "bulb"],
  ["project", "folder"],
  ["skill_meta", "skill"],
  ["visualize", "bars"],
  ["connector_cards", "grid"],
  ["web_fetch", "globe"],
  ["utility", "wrench"],
  ["workspace", "device"],
  ["image", "image"],
];

const ready = <T>(read: Read<T> | undefined) => (read?.state === "ready" ? read.value : undefined);

/** A wallpaper's name and where it comes from: "Constellation · Built-in", "Dusk · by Mina". */
function wallpaperText(lang: Lang, w: StudioWallpaper): string {
  const t = (key: BoardKey, vars?: Record<string, string>) => boardText(lang, key, vars);
  const engine = `wp_${w.id}`;
  const name = w.source === "builtin" ? (isBoardKey(engine) ? t(engine) : w.id) : (w.name ?? w.id);
  const from =
    w.source === "builtin"
      ? t("builtinSource")
      : w.source === "mine"
        ? t("mineSource")
        : w.author
          ? t("byAuthor", { author: w.author })
          : t("gallerySource");
  return `${name} · ${from}`;
}

export function studioBoard(
  lang: Lang,
  agent: StudioAgent,
  read: Read<StudioAgentsFacetsResult> | undefined,
  conversations: readonly StudioConversation[],
  now: number = Date.now(),
): Board {
  const t = (key: BoardKey, vars?: Record<string, string | number>) => boardText(lang, key, vars);
  const facets = ready(read);
  const waiting = read?.state === "loading" ? "…" : "—";
  const missing = (facet: string) => !facets || facets.problems.some((p) => p.facet === facet);
  const rows: RowFacts = { lang, agent, facets, waiting, now };
  const bound = facets?.connectors ?? [];

  // The agent's sheet.
  const settings = facets?.settings;
  const disabled = new Set(settings?.disabledToolGroups ?? []);
  const available = settings?.availableToolGroups ?? [];
  const tools: Badge[] = [
    ...TOOLS.filter(([key]) => available.includes(key)),
    // A group endue AI has and the desk has no icon for keeps its place, under its own name.
    ...available.filter((key) => !TOOLS.some(([k]) => k === key)).map((key) => [key, "wrench"]),
  ].map(([key = "", icon = "wrench"]) => ({
    key,
    label: isBoardKey(key) ? t(key) : key,
    on: !disabled.has(key),
    icon,
  }));
  const on = new Set(facets?.traits.filter((x) => x.enabled).map((x) => x.key));
  const traits: Badge[] = TRAITS.filter(([key]) => key !== "autonomy" || on.has(key)).map(
    ([key, icon]) => ({ key, label: isBoardKey(key) ? t(key) : key, on: on.has(key), icon }),
  );
  const first = facets?.prompt?.content
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  const model = shortModel(settings?.model.default);
  const skills = (facets?.skills ?? []).filter((s) => s.enabled).map((s) => s.name || s.slug || "");
  const memory = missing("memory") ? undefined : facets?.memory;
  const theme = missing("theme") ? undefined : facets?.theme;
  const identity: SheetRow[] = [
    {
      section: "prompt",
      label: t("prompt"),
      value: missing("prompt") ? waiting : first ? `“${first}”` : t("noPrompt"),
      muted: missing("prompt") || !first,
    },
    {
      section: "memory",
      label: t("memory"),
      value: !memory
        ? waiting
        : memory.memories
          ? t("memoryValue", { m: `${memory.memories}${memory.more ? "+" : ""}`, r: memory.rules })
          : t("noMemory"),
      muted: !memory?.memories,
    },
    {
      section: "trait",
      label: t("traits"),
      value: missing("traits") ? waiting : "",
      muted: missing("traits"),
      ...(missing("traits") ? {} : { badges: traits }),
    },
    {
      section: "model",
      label: t("model"),
      value: missing("settings") ? waiting : model || t("defaultModel"),
      muted: missing("settings"),
    },
    {
      section: "wallpaper",
      label: t("wallpaper"),
      value: !theme
        ? waiting
        : theme.wallpaper
          ? wallpaperText(lang, theme.wallpaper)
          : t("noWallpaper"),
      muted: !theme?.wallpaper,
    },
  ];

  const presence = enduePresence(agent, conversations);
  const healthy = bound
    .filter((c) => connectorState(c) === "on")
    .map((c) => c.name || c.type || "");
  const facts: Capability = {
    inputs: [t("consoleTitle"), ...inputsOn(rows)],
    skills: skills.length,
    tools: tools.filter((x) => x.on).length,
    outputs: healthy.slice(0, 2),
    moreOutputs: Math.max(0, healthy.length - 2),
    broken: bound.filter((c) => connectorState(c) === "bad").map((c) => c.name || c.type || ""),
  };
  const name = agent.name || agent.slug;
  return {
    inbound: inboundRows(rows),
    outbound: outboundRows(rows),
    connectors: { count: bound.length, more: Math.max(0, bound.length - MAX_CONNECTORS) },
    hub: {
      name,
      initial: initialOf(name),
      handle: [`@${agent.slug}`, facets?.identity?.role].filter(Boolean).join(" · "),
      description: (agent.description ?? facets?.identity?.description ?? "").trim(),
      presence,
      presenceLabel: presenceText(lang, presence),
      sentence: capability(lang, facts),
      identity,
      skills: {
        label: t("skills", { n: skills.length }),
        chips: skills.slice(0, MAX_CHIPS),
        more: Math.max(0, skills.length - MAX_CHIPS),
      },
      tools: {
        section: "tools",
        label: t("tools"),
        value: missing("settings") ? waiting : "",
        muted: missing("settings"),
        stack: true,
        ...(missing("settings") ? {} : { badges: tools }),
      },
    },
  };
}
