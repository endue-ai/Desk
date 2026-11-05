// The presentations of words as data: a list's rows, a document's sections, a chat's messages and
// an agent's run. Pure; the element draws them.
import { byStart, type UniversalRow, type UniversalTone } from "./rows";
import { dayLabel, dayOf, durationText, timeText, type UniversalEnv } from "./time";

/** A list: the rows in their order, or by start when an order is given. */
export function listOf(rows: UniversalRow[], order?: "asc" | "desc"): UniversalRow[] {
  return order ? byStart(rows, order) : [...rows];
}

export interface TextSection {
  row: UniversalRow;
  /** "" when the entry has no title: its text runs on from the one before. */
  heading: string;
  markdown: string;
}

/** A document: each entry a section, its title the heading and its text the body. */
export function textOf(rows: UniversalRow[]): TextSection[] {
  return rows.map((row) => ({ row, heading: row.title, markdown: row.text || row.detail }));
}

export interface ChatMessage {
  row: UniversalRow;
  /** The person's own, drawn on the other side. */
  mine: boolean;
  /** "" when the message has no time. */
  time: string;
  /** Whether it starts a run of one author's messages, and so shows the author. */
  first: boolean;
}

export interface ChatDay {
  /** "" for messages without a time. */
  day: string;
  label: string;
  messages: ChatMessage[];
}

const OWN = new Set(["me", "user", "self"]);

/** Whether a row is the person's own message: its author or role is `me` (me, user, self when absent). */
export function isMine(row: UniversalRow, me?: string): boolean {
  if (me !== undefined) {
    const own = me.trim().toLowerCase();
    return row.author.trim().toLowerCase() === own || row.role === own;
  }
  return OWN.has(row.role) || OWN.has(row.author.trim().toLowerCase());
}

/** A chat: messages in time order when every one has a time, else as written; by day. */
export function chatOf(rows: UniversalRow[], env: UniversalEnv, me?: string): ChatDay[] {
  const timed = rows.every((row) => row.start !== undefined);
  const ordered = timed ? byStart(rows) : [...rows];
  const year = Number(dayOf(env.now, env.zone).slice(0, 4));
  const days: ChatDay[] = [];
  const who = (r: UniversalRow) => `${isMine(r, me)}:${r.author || r.role}`;
  let previous: UniversalRow | undefined;
  for (const row of ordered) {
    const day = row.start === undefined ? "" : dayOf(row.start, env.zone);
    let last = days[days.length - 1];
    if (!last || (day && last.day !== day)) {
      last = { day, label: day ? dayLabel(day, env, year) : "", messages: [] };
      days.push(last);
      previous = undefined;
    }
    last.messages.push({
      row,
      mine: isMine(row, me),
      time: row.start === undefined ? "" : timeText(row.start, env),
      first: !previous || who(previous) !== who(row),
    });
    previous = row;
  }
  return days;
}

export interface AgentStep {
  row: UniversalRow;
  tone: UniversalTone;
  /** The status as written, or the tone's word. */
  status: string;
  time: string;
  /** How long it took (end − start), or how long it has run so far. */
  duration: string;
}

export interface AgentModel {
  /** The run's state: failed, waiting or running when a step is, done when all are, else pending. */
  tone: UniversalTone;
  /** Done 3 of 5. */
  summary: string;
  steps: AgentStep[];
}

/** An agent's run: its steps as written, each with its state and how long it took. */
export function agentOf(rows: UniversalRow[], env: UniversalEnv): AgentModel {
  const steps = rows.map((row): AgentStep => {
    const tone = row.tone;
    const running = tone === "running" && row.start !== undefined && row.end === undefined;
    const took =
      row.start === undefined
        ? Number.NaN
        : (row.end ?? (running ? env.now : Number.NaN)) - row.start;
    return {
      row,
      tone,
      status: row.status || tone,
      time: row.start === undefined ? "" : timeText(row.start, env),
      duration: durationText(took),
    };
  });
  const has = (tone: UniversalTone) => steps.some((step) => step.tone === tone);
  const done = steps.filter((step) => step.tone === "done").length;
  const tone: UniversalTone = has("failed")
    ? "failed"
    : has("waiting")
      ? "waiting"
      : has("running")
        ? "running"
        : steps.length > 0 && done === steps.length
          ? "done"
          : "pending";
  return { tone, summary: `Done ${done} of ${steps.length}`, steps };
}
