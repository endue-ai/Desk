import type { LocalAgentMessage, LocalAgentRun, LocalAgentSession } from "@endue-ai/bridge";

export type SessionSource = "local" | "archive" | "desk" | "plugin";
export interface SessionRow {
  key: string;
  title: string;
  agent: string;
  agentName: string;
  sources: SessionSource[];
  nativeId?: string;
  workspace?: string;
  branch?: string;
  model?: string;
  updatedAt?: string;
  status?: "working" | "waiting" | "done" | "failed" | "stopped" | "missing";
}
export interface SessionTurn {
  id: string;
  role: "user" | "assistant" | "tool" | "failure" | "notification" | "plan" | "excerpt" | "record";
  text: string;
  name?: string;
  at?: string;
  cut?: boolean;
  steps?: { text: string; state: string }[];
  proposed?: boolean;
}
export interface SessionRequest {
  id: string;
  text: string;
  choices: { id: string; label: string }[];
  respond?: (choice: string) => Promise<void | boolean>;
}
export interface SessionView {
  rows: SessionRow[];
  selected?: SessionRow;
  turns: SessionTurn[];
  lang?: string;
  now?: number;
  notice?: string;
  listNotice?: string;
  empty?: string;
  older?: "more" | "end" | "loading";
  request?: SessionRequest;
  pages?: { id: string; label: string }[];
  onPage?: (id: string) => void;
  onOlder?: () => void;
  onSelect?: (row: SessionRow, source?: SessionSource) => void;
  onQuery?: (query: string) => void;
  onPreview?: (row: SessionRow) => Promise<SessionTurn[]>;
  onRetry?: () => void;
  onRetryList?: () => void;
  onNew?: () => void;
}
/** Only a complete absolute location from this adapter's local access boundary defines a group. */
export function workspacePath(cwd?: string): string | undefined {
  if (!cwd || !/^(?:\/|[A-Za-z]:[\\/])/.test(cwd) || /(?:^|[\\/])\.{1,2}(?:[\\/]|$)/.test(cwd))
    return;
  return cwd;
}
export const sessionKey = (agent: string, source: string, id = "") =>
  JSON.stringify([agent, source, id]);
export function nativeSessionRow(
  s: LocalAgentSession,
  name: string,
  source?: SessionSource,
): SessionRow {
  const sources: SessionSource[] = [source ?? (s.archived ? "archive" : "local")];
  if (s.imported && !sources.includes("desk")) sources.push("desk");
  return {
    key: sessionKey(s.agent, sources[0] ?? "local", s.id),
    nativeId: s.id,
    agent: s.agent,
    agentName: name,
    title: s.title.trim() || s.id.slice(0, 8),
    sources,
    workspace: workspacePath(s.cwd),
    branch: s.branch,
    model: s.model,
    updatedAt: s.updatedAt,
  };
}
/** Source membership is independent of the adapter used for the next send. */
export function mergeSessionRows(rows: SessionRow[]): SessionRow[] {
  const merged = new Map<string, SessionRow>();
  for (const row of rows) {
    const id = row.nativeId ? sessionKey(row.agent, "native", row.nativeId) : row.key;
    const prior = merged.get(id);
    if (!prior) {
      merged.set(id, row);
      continue;
    }
    const primary = prior.sources[0] === "plugin" && row.sources[0] !== "plugin" ? row : prior;
    merged.set(id, { ...primary, sources: [...new Set([...prior.sources, ...row.sources])] });
  }
  return [...merged.values()].sort(
    (a, b) =>
      (Date.parse(b.updatedAt ?? "") || 0) - (Date.parse(a.updatedAt ?? "") || 0) ||
      a.key.localeCompare(b.key),
  );
}
/** Recognise plan data only in a named tool record. Quoted JSON and clipped payloads remain text. */
export function sessionTool(name: string, text: string, input?: unknown): Omit<SessionTurn, "id"> {
  const fallback = { role: "tool" as const, name, text };
  if (!/(?:^|[._])(?:update_plan|TodoWrite)$/i.test(name)) return fallback;
  let value = input;
  if (!value) {
    try {
      value = JSON.parse(text);
    } catch {
      return fallback;
    }
  }
  if (!value || typeof value !== "object") return fallback;
  const data = value as Record<string, unknown>;
  const list = data.plan ?? data.items ?? data.todos;
  if (!Array.isArray(list) || !list.length) return fallback;
  const steps = [];
  for (const item of list) {
    if (!item || typeof item !== "object") return fallback;
    const label = item.step ?? item.content;
    if (typeof label !== "string" || typeof item.status !== "string") return fallback;
    steps.push({ text: label, state: item.status });
  }
  return { role: "plan", text, name, steps };
}
/** Count from the end so prepending an overlapping tail preserves the IDs of repeated messages. */
export function nativeSessionTurns(messages: LocalAgentMessage[]): SessionTurn[] {
  const counts = new Map<string, number>();
  return messages
    .slice()
    .reverse()
    .map((m) => {
      const value = JSON.stringify([m.role, m.name, m.at, m.text]);
      let h = 2166136261;
      for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
      const stem = (h >>> 0).toString(36),
        n = counts.get(stem) ?? 0;
      counts.set(stem, n + 1);
      const event = m.role === "tool" && !m.cut ? sessionTool(m.name ?? "Tool", m.text) : m;
      return { ...m, ...event, id: `turn-${stem}-${n}` };
    })
    .reverse();
}

/** Keep streamed turns readable while the program is still writing its transcript. */
export function appendSessionRun(turns: SessionTurn[], run: LocalAgentRun, parts: SessionTurn[]) {
  const start = Math.floor(Date.parse(run.startedAt) / 1000);
  const prompt = turns.findLastIndex(
    (t) =>
      t.role === "user" &&
      (t.text === run.prompt || (run.prompt.length >= 500 && t.text.startsWith(run.prompt))) &&
      (!t.at || Math.floor(Date.parse(t.at) / 1000) >= start),
  );
  const recorded = prompt < 0 ? [] : turns.slice(prompt + 1);
  // A later prompt in the file already places this historical run before the current turn.
  if (recorded.some((t) => t.role === "user")) return;
  if (prompt < 0 && run.prompt)
    turns.push({ id: run.runId + ":prompt", role: "user", text: run.prompt, at: run.startedAt });
  const answer = recorded
    .filter((t) => t.role === "assistant")
    .map((t) => t.text)
    .join("\n\n");
  if (!answer || answer !== run.text) {
    let from = 0;
    const stream = [...parts];
    const streamed = parts
      .filter((t) => t.role === "assistant")
      .map((t) => t.text)
      .join("\n\n");
    if (run.text && (!streamed || run.text.startsWith(streamed + "\n\n")))
      stream.push({
        id: run.runId + ":text",
        role: "assistant",
        text: streamed ? run.text.slice(streamed.length + 2) : run.text,
      });
    for (const part of stream) {
      const seen = recorded.findIndex(
        (t, i) => i >= from && t.role === part.role && t.name === part.name && t.text === part.text,
      );
      if (seen < 0) turns.push(part);
      else from = seen + 1;
    }
  }
  if (run.state === "failed" && run.error)
    turns.push({ id: run.runId + ":error", role: "failure", text: run.error });
}
export type SessionRead = {
  session: LocalAgentSession;
  messages: LocalAgentMessage[];
  truncated: boolean;
};
export class SessionHistory {
  result?: SessionRead;
  older?: SessionView["older"];
  error = "";
  loading = false;
  #limit = 200;
  #generation = 0;
  #read?: (limit: number) => Promise<SessionRead>;
  constructor(private readonly changed: () => void) {}
  clear(): void {
    this.#generation++;
    this.#read = undefined;
    this.#limit = 200;
    this.result = undefined;
    this.error = "";
    this.older = undefined;
    this.loading = false;
  }
  open(read: (limit: number) => Promise<SessionRead>): Promise<void> {
    this.clear();
    this.#read = read;
    return this.#load(200, false);
  }
  refresh(): Promise<void> {
    return this.#load(this.#limit, false);
  }
  more(): Promise<void> {
    return this.older === "more"
      ? this.#load(Math.min(1000, this.#limit + 200), true)
      : Promise.resolve();
  }
  async #load(limit: number, more: boolean): Promise<void> {
    if (!this.#read) return;
    const gen = ++this.#generation,
      before = this.result?.messages.length ?? 0;
    this.loading = true;
    this.error = "";
    if (more) this.older = "loading";
    this.changed();
    try {
      const result = await this.#read(limit);
      if (gen !== this.#generation) return;
      this.result = result;
      this.#limit = limit;
      this.older = result.truncated
        ? limit >= 1000 || (more && result.messages.length <= before)
          ? "end"
          : "more"
        : undefined;
    } catch (err) {
      if (gen !== this.#generation) return;
      this.error = err instanceof Error ? err.message : String(err);
      if (more) this.older = "more";
    }
    this.loading = false;
    this.changed();
  }
}
