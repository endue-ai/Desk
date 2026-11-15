/**
 * What an endue agent's Studio board shows, without a DOM (ADR 0232): the ways requests come in,
 * the agent's own sheet, and what it reaches, each row with the state its line is drawn in. It
 * reads the agent and its facets (studio.*) and nothing else; what the bridge does not read
 * (channels, API keys, devices, outputs, memory, wallpaper) is `unknown`, never guessed: the row
 * says to look on endue.ai and opens that part of Studio there.
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioConnector,
  StudioConversation,
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
import { initialOf, presenceText, shortModel } from "./model";

/** A line's state: on (solid), off (dashed), a problem, or not read by the desk (dashed, muted). */
export type LineState = "on" | "off" | "bad" | "unknown";

/** Something a row offers: it opens a part of endue.ai's Studio, or the agent's own page. */
export interface RowAction {
  key: string;
  label: string;
  /** The Studio section it opens (`channel`, `prompt`); the agent's own page without one. */
  section?: string;
  primary?: boolean;
}

export interface BoardRow {
  id: string;
  side: "in" | "out";
  /** An icon's name, or two letters for a connector. */
  icon?: string;
  mono?: string;
  title: string;
  sub: string;
  subTone?: "ok" | "bad";
  state: LineState;
  /** Words at the row's right end: On, Off. */
  meta?: string;
  /** What unfolds under the row; a row without it opens its section at once. */
  body?: { text: string[]; actions: RowAction[] };
  /** The Studio section a press opens when nothing unfolds. */
  section: string;
}

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

/** The connector rows the board shows; the rest are one "more" line. */
export const MAX_CONNECTORS = 6;
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

/** A connector's line: off while turned off, a problem while its sign-in has expired. */
export function connectorState(c: Pick<StudioConnector, "enabled" | "status">): LineState {
  if (!c.enabled) return "off";
  return c.status === "expired" ? "bad" : "on";
}

const switched = (value: boolean | undefined): LineState =>
  value === undefined ? "unknown" : value ? "on" : "off";

export function studioBoard(
  lang: Lang,
  agent: StudioAgent,
  read: Read<StudioAgentsFacetsResult> | undefined,
  conversations: readonly StudioConversation[],
): Board {
  const t = (key: BoardKey, vars?: Record<string, string | number>) => boardText(lang, key, vars);
  const facets = ready(read);
  const waiting = read?.state === "loading" ? "…" : "—";
  const missing = (facet: string) => !facets || facets.problems.some((p) => p.facet === facet);
  const address = `endue.live/@${agent.slug}`;
  const live = switched(agent.liveEnabled);
  const mcp = switched(agent.mcpEnabled);
  const word = (state: LineState) =>
    state === "on" ? t("on") : state === "off" ? t("off") : undefined;
  const details = (section: string): RowAction => ({
    key: "details",
    label: t("details"),
    section,
  });

  const inbound: BoardRow[] = [
    {
      id: "console",
      side: "in",
      icon: "chat",
      title: t("consoleTitle"),
      sub: t("consoleSub"),
      state: "on",
      section: "canvas",
      body: {
        text: [t("consoleBody")],
        actions: [{ key: "open", label: t("consoleOpen"), primary: true }],
      },
    },
    {
      id: "channel",
      side: "in",
      icon: "channel",
      title: t("channelTitle"),
      sub: t("channelSub"),
      state: "unknown",
      section: "channel",
      body: {
        text: [t("channelBody")],
        actions: [
          { key: "add", label: t("channelAdd"), section: "channel", primary: true },
          details("channel"),
        ],
      },
    },
    {
      id: "live",
      side: "in",
      icon: "radio",
      title: t("liveTitle"),
      sub: live === "unknown" ? t("liveSub") : address,
      state: live,
      ...(word(live) ? { meta: word(live) } : {}),
      section: "live",
      body: {
        text: [
          live === "on" ? t("liveOn") : t("liveOff", { address }),
          ...(live === "on" ? [address] : []),
        ],
        actions: [details("live")],
      },
    },
    {
      id: "api",
      side: "in",
      icon: "key",
      title: t("apiTitle"),
      sub: t("apiSub"),
      state: "unknown",
      section: "api",
      body: {
        text: [t("apiBody")],
        actions: [
          { key: "add", label: t("apiCreate"), section: "api", primary: true },
          details("api"),
        ],
      },
    },
    {
      id: "mcp",
      side: "in",
      icon: "link",
      title: t("mcpTitle"),
      sub: t("mcpSub"),
      state: mcp,
      ...(word(mcp) ? { meta: word(mcp) } : {}),
      section: "mcp",
      body: {
        text: [mcp === "on" ? t("mcpOn") : t("mcpOff")],
        actions: [{ key: "details", label: t("mcpConnect"), section: "mcp" }],
      },
    },
  ];

  const bound = facets?.connectors ?? [];
  const shown = bound.slice(0, MAX_CONNECTORS);
  const outbound: BoardRow[] = [
    ...shown.map((c): BoardRow => {
      const state = connectorState(c);
      const name = c.name || c.type || t("connectorsGroup", { n: "" }).trim();
      return {
        id: `connector-${c.id}`,
        side: "out",
        mono: [...name].slice(0, 2).join("").toUpperCase(),
        title: name,
        sub:
          state === "off"
            ? t("connectorOff")
            : state === "bad"
              ? t("connectorAttention")
              : c.status === "active"
                ? t("connectorActive")
                : t("connectorUnverified"),
        ...(state === "bad"
          ? { subTone: "bad" as const }
          : state === "on" && c.status === "active"
            ? { subTone: "ok" as const }
            : {}),
        state,
        section: "connectors",
      };
    }),
    {
      id: "devices",
      side: "out",
      icon: "device",
      title: t("devicesTitle"),
      sub: t("devicesSub"),
      state: "unknown",
      section: "devices",
    },
    {
      id: "outputs",
      side: "out",
      icon: "box",
      title: t("outputsTitle"),
      sub: t("outputsSub"),
      state: "on",
      section: "artifacts",
      body: {
        text: [],
        actions: [
          { key: "outputs", label: t("outputsView"), section: "artifacts" },
          { key: "workspace", label: t("workspaceOpen"), section: "workspaces" },
        ],
      },
    },
  ];

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
  const identity: SheetRow[] = [
    {
      section: "prompt",
      label: t("prompt"),
      value: missing("prompt") ? waiting : first ? `“${first}”` : t("noPrompt"),
      muted: missing("prompt") || !first,
    },
    { section: "memory", label: t("memory"), value: t("onEndue"), muted: true },
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
    { section: "wallpaper", label: t("wallpaper"), value: t("onEndue"), muted: true },
  ];

  const presence = enduePresence(agent, conversations);
  const healthy = bound
    .filter((c) => connectorState(c) === "on")
    .map((c) => c.name || c.type || "");
  const facts: Capability = {
    inputs: [
      t("consoleTitle"),
      ...(live === "on" ? [t("liveTitle")] : []),
      ...(mcp === "on" ? [t("mcpTitle")] : []),
    ],
    skills: skills.length,
    tools: tools.filter((x) => x.on).length,
    outputs: healthy.slice(0, 2),
    moreOutputs: Math.max(0, healthy.length - 2),
    broken: bound.filter((c) => connectorState(c) === "bad").map((c) => c.name || c.type || ""),
  };
  const name = agent.name || agent.slug;
  return {
    inbound,
    outbound,
    connectors: { count: bound.length, more: bound.length - shown.length },
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
