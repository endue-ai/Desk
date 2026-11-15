/**
 * The two outer columns of an endue agent's Studio board, without a DOM (ADR 0232): where requests
 * come in (console chat, channels, Live, API, MCP) and what the agent reaches (connectors, devices,
 * outputs), each row in the state its line is drawn in, as endue.ai's board decides it. A row reads
 * its facet; one not read yet, or not answered by endue AI, is `unknown`: never guessed, never
 * counted, and it says to look on endue.ai.
 */
import type {
  StudioAgent,
  StudioAgentsFacetsResult,
  StudioApiKey,
  StudioChannel,
  StudioConnector,
  StudioFacet,
} from "@endue-ai/bridge";
import type { Lang } from "../../shell/copy";
import { ago } from "../local-agent/model";
import { type BoardKey, boardText, isBoardKey } from "./board-copy";

/** A line's state: on (solid), off (dashed), a problem, or not read by the desk (dashed, muted). */
export type LineState = "on" | "off" | "bad" | "unknown";

/** Something a row offers: it opens a part of endue.ai's Studio, or the agent's own page. */
export interface RowAction {
  key: string;
  label: string;
  /** The Studio section it opens (`channel`, `prompt`); the agent's own page without one. */
  section?: string;
  primary?: boolean;
  /** How an item stands, when it is not simply on: about to stop (warn) or done (muted). */
  tone?: "warn" | "muted";
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
  /** Words at the row's right end: On, Off, a count. */
  meta?: string;
  /** What unfolds under the row: words, its items, then what to do; a row without it opens at once. */
  body?: { text: string[]; items?: RowAction[]; actions: RowAction[] };
  /** The Studio section a press opens when nothing unfolds. */
  section: string;
}

/** What the rows are made from. */
export interface RowFacts {
  lang: Lang;
  agent: StudioAgent;
  facets: StudioAgentsFacetsResult | undefined;
  /** What a row not read says: on its way (…) or not answered (—). */
  waiting: string;
  now: number;
}

/** The connector rows the board shows; the rest are one "more" line. */
export const MAX_CONNECTORS = 6;
/** A key that stops working within this long expires soon, as endue.ai says: 7 days. */
export const EXPIRING_SOON_MS = 7 * 24 * 60 * 60 * 1000;

/** A connector's line: off while turned off, a problem while its sign-in has expired. */
export function connectorState(c: Pick<StudioConnector, "enabled" | "status">): LineState {
  if (!c.enabled) return "off";
  return c.status === "expired" ? "bad" : "on";
}

/** A key's life: endless or far off, within a week, or over. A time that cannot be read is not over. */
export function keyState(key: Pick<StudioApiKey, "expiresAt">, now: number) {
  const at = key.expiresAt ? Date.parse(key.expiresAt) : Number.NaN;
  if (Number.isNaN(at)) return "active";
  if (at <= now) return "expired";
  return at - now <= EXPIRING_SOON_MS ? "expiring" : "active";
}

const switched = (value: boolean | undefined): LineState =>
  value === undefined ? "unknown" : value ? "on" : "off";

/** Whether `facet` was read: the facets came, and endue AI answered for it. */
const readOf = (facets: StudioAgentsFacetsResult | undefined, facet: StudioFacet) =>
  facets !== undefined && !facets.problems.some((p) => p.facet === facet);

const words = (lang: Lang) => (key: BoardKey, vars?: Record<string, string | number>) =>
  boardText(lang, key, vars);

/** A channel's name: what endue AI shows for it, else its provider's. */
export function channelName(lang: Lang, c: StudioChannel): string {
  const key = `ch_${c.provider}`;
  return c.name || (isBoardKey(key) ? boardText(lang, key) : c.provider);
}

/** The active channels' names and, when a key still works, the API: the ways in that are on. */
export function inputsOn(f: RowFacts): string[] {
  const t = words(f.lang);
  const channels = readOf(f.facets, "channels") ? (f.facets?.channels ?? []) : [];
  const keys = readOf(f.facets, "apiKeys") ? (f.facets?.apiKeys ?? []) : [];
  return [
    ...channels.filter((c) => c.status === "active").map((c) => channelName(f.lang, c)),
    ...(f.agent.liveEnabled ? [t("liveTitle")] : []),
    ...(keys.some((k) => keyState(k, f.now) !== "expired") ? [t("apiTitle")] : []),
    ...(f.agent.mcpEnabled ? [t("mcpTitle")] : []),
  ];
}

export function inboundRows(f: RowFacts): BoardRow[] {
  const t = words(f.lang);
  const address = `endue.live/@${f.agent.slug}`;
  const live = switched(f.agent.liveEnabled);
  const mcp = switched(f.agent.mcpEnabled);
  const word = (state: LineState) =>
    state === "on" ? t("on") : state === "off" ? t("off") : undefined;
  const details = (section: string): RowAction => ({
    key: "details",
    label: t("details"),
    section,
  });
  const unread = [t("onEndue")];

  const channelsRead = readOf(f.facets, "channels");
  const channels = channelsRead ? (f.facets?.channels ?? []) : [];
  const names = channels.map((c) => channelName(f.lang, c));
  const keysRead = readOf(f.facets, "apiKeys");
  const keys = keysRead ? (f.facets?.apiKeys ?? []) : [];

  return [
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
      sub: names.length
        ? `${names.slice(0, 2).join(" · ")}${names.length > 2 ? ` +${names.length - 2}` : ""}`
        : t("channelSub"),
      state: !channelsRead ? "unknown" : channels.some((c) => c.status === "active") ? "on" : "off",
      meta: !channelsRead
        ? f.waiting
        : channels.length
          ? t("channelCount", { n: channels.length })
          : t("none"),
      section: "channel",
      body: {
        text: !channelsRead ? unread : channels.length ? [] : [t("channelBody")],
        items: channels.map((c, i) => ({
          key: `item-${c.id}`,
          label: `${names[i]} · ${c.status === "active" ? t("active") : t("inactive")}`,
          section: "channel",
        })),
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
      state: !keysRead
        ? "unknown"
        : keys.some((k) => keyState(k, f.now) !== "expired")
          ? "on"
          : "off",
      meta: keysRead ? t(keys.length === 1 ? "apiKey" : "apiKeys", { n: keys.length }) : f.waiting,
      section: "api",
      body: {
        text: !keysRead ? unread : keys.length ? [] : [t("apiBody")],
        items: keys.map((k) => {
          const life = keyState(k, f.now);
          const name = k.name || t("apiTitle");
          return life === "expired"
            ? {
                key: `item-${k.id}`,
                label: `${name} · ${t("expired")}`,
                section: "api",
                tone: "muted",
              }
            : life === "expiring"
              ? {
                  key: `item-${k.id}`,
                  label: `${name} · ${t("expiring")}`,
                  section: "api",
                  tone: "warn",
                }
              : { key: `item-${k.id}`, label: name, section: "api" };
        }),
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
}

const KINDS = ["computer", "chrome", "android"] as const;

export function outboundRows(f: RowFacts): BoardRow[] {
  const t = words(f.lang);
  const bound = readOf(f.facets, "connectors") ? (f.facets?.connectors ?? []) : [];
  const devicesRead = readOf(f.facets, "devices");
  const devices = devicesRead ? (f.facets?.devices ?? []) : [];
  const kinds = KINDS.filter((k) => devices.some((d) => d.kind === k));
  const outputs = readOf(f.facets, "outputs") ? f.facets?.outputs : undefined;
  const when = outputs?.latestAt ? ago(f.lang, outputs.latestAt, f.now) : "";
  return [
    ...bound.slice(0, MAX_CONNECTORS).map((c): BoardRow => {
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
      sub: kinds.length ? kinds.map((k) => t(k)).join(" · ") : t("devicesSub"),
      state: !devicesRead ? "unknown" : devices.length ? "on" : "off",
      meta: !devicesRead
        ? f.waiting
        : devices.length
          ? t("devicesCount", { n: devices.length })
          : t("none"),
      section: "devices",
    },
    {
      id: "outputs",
      side: "out",
      icon: "box",
      title: t("outputsTitle"),
      sub: !outputs
        ? t("outputsSub")
        : !outputs.count
          ? t("outputsNone")
          : when
            ? t("outputsLatest", { n: outputs.count, when })
            : t("outputsCount", { n: outputs.count }),
      state: outputs ? "on" : "unknown",
      section: "artifacts",
      body: {
        text: outputs ? [] : [t("onEndue")],
        actions: [
          { key: "outputs", label: t("outputsView"), section: "artifacts" },
          { key: "workspace", label: t("workspaceOpen"), section: "workspaces" },
        ],
      },
    },
  ];
}
