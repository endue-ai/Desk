/**
 * What a local agent's screen shows, without the DOM: the tab counts, a session's line, a folder as
 * people read it, how long ago, and the runs of one agent.
 */
import type {
  LocalAgent,
  LocalAgentRun,
  LocalAgentSession,
  LocalAgentSource,
} from "@endue-ai/bridge";
import type { Lang } from "../../shell/copy";
import { localText } from "./copy";

/** The tabs of the screen, in order: the program's sessions, its archive, the desk's copies. */
export const TABS: readonly LocalAgentSource[] = ["local", "archive", "desk"];

/** How many sessions a tab holds, from the agent's counts. */
export function tabCount(agent: LocalAgent | undefined, tab: LocalAgentSource): number {
  if (!agent) return 0;
  if (tab === "local") return agent.sessions;
  if (tab === "archive") return agent.archived;
  return agent.imported;
}

export function tabLabel(lang: Lang, agent: LocalAgent | undefined, tab: LocalAgentSource): string {
  const key = tab === "local" ? "tabLocal" : tab === "archive" ? "tabArchive" : "tabDesk";
  return localText(lang, key, { n: tabCount(agent, tab) });
}

/** The last two parts of a folder (`work/atlas`), which tell projects apart without the home. */
export function folderOf(cwd: string | undefined): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join("/");
}

/** "3 min ago" from an RFC 3339 time and now, in wall-clock milliseconds. */
export function ago(lang: Lang, at: string | undefined, now: number): string {
  const then = at ? Date.parse(at) : Number.NaN;
  if (Number.isNaN(then)) return "";
  const minutes = Math.max(0, Math.floor((now - then) / 60_000));
  if (minutes < 1) return localText(lang, "justNow");
  if (minutes < 60) return localText(lang, "minutesAgo", { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return localText(lang, "hoursAgo", { n: hours });
  return localText(lang, "daysAgo", { n: Math.floor(hours / 24) });
}

/** The line under a session's title: folder · branch · when. */
export function sessionMeta(lang: Lang, session: LocalAgentSession, now: number): string {
  return [folderOf(session.cwd), session.branch, ago(lang, session.updatedAt, now)]
    .filter(Boolean)
    .join(" · ");
}

/** A session's title, or its id's start when its program gave none and nobody asked anything. */
export const titleOf = (session: LocalAgentSession) =>
  session.title.trim() || session.id.slice(0, 8);

/** One agent's runs, newest first: the ones going on before the ones that ended. */
export function runsOf(runs: readonly LocalAgentRun[], agent: string): LocalAgentRun[] {
  const mine = runs.filter((r) => r.agent === agent);
  return [
    ...mine.filter((r) => r.state === "running"),
    ...mine.filter((r) => r.state !== "running"),
  ];
}

/** The line about a program: its vendor, version and where it runs from, or that it is missing. */
export function programLine(lang: Lang, agent: LocalAgent): string {
  if (!agent.program) return [agent.vendor, localText(lang, "noProgram")].join(" · ");
  return [agent.vendor, agent.version ? `v${agent.version}` : "", agent.program]
    .filter(Boolean)
    .join(" · ");
}

/** What an import says once it is done. */
export function importLine(
  lang: Lang,
  result: { imported: number; unchanged: number; failed: number },
): string {
  const line = localText(lang, "imported", { n: result.imported, same: result.unchanged });
  return result.failed
    ? `${line} · ${localText(lang, "importFailedSome", { n: result.failed })}`
    : line;
}

/** Why a bridge call failed, for people. */
export const why = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
