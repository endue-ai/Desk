// The app's CPU from `ps -A -o pid=,ppid=,time=,comm=`: each process's CPU time so far, and what
// a stretch between two readings cost, as a share of one core (#134). Pure: cpu.test.ts.
import { round1 } from "./stats";

export interface CpuProc {
  pid: number;
  ppid: number;
  /** CPU time used so far, in seconds. */
  seconds: number;
  name: string;
}

/** `ps`'s `time`: `[[dd-]hh:]mm:ss[.ff]`, in seconds. */
export function cpuTime(text: string): number | null {
  const [days, clock] = text.includes("-") ? text.split("-", 2) : ["0", text];
  const parts = (clock ?? "").split(":").map(Number);
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return null;
  return Number(days) * 86_400 + parts.reduce((sum, p) => sum * 60 + p, 0);
}

/** The processes in `ps` output; lines that are not `pid ppid time name` are passed over. */
export function parseCpu(text: string): CpuProc[] {
  const procs: CpuProc[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, time, name] = match;
    const seconds = cpuTime(time as string);
    if (seconds === null) continue;
    procs.push({ pid: Number(pid), ppid: Number(ppid), seconds, name: name as string });
  }
  return procs;
}

/** `pid` and every process under it. */
export function cpuTree(procs: readonly CpuProc[], pid: number): CpuProc[] {
  const tree = procs.filter((p) => p.pid === pid);
  for (let i = 0; i < tree.length; i++) {
    const parent = tree[i] as CpuProc;
    tree.push(...procs.filter((p) => p.ppid === parent.pid && p.pid !== parent.pid));
  }
  return tree;
}

/**
 * What the stretch from `before` to `after` (`seconds` apart) cost, in % of one core: the app's own
 * process, and its whole tree (processes that came or went in between count what they have).
 */
export function cpuPercent(
  before: readonly CpuProc[],
  after: readonly CpuProc[],
  pid: number,
  seconds: number,
): { app: number | null; tree: number } {
  const was = new Map(before.map((p) => [p.pid, p.seconds]));
  const spent = (p: CpuProc) => Math.max(0, p.seconds - (was.get(p.pid) ?? 0));
  const tree = cpuTree(after, pid);
  const app = tree.find((p) => p.pid === pid);
  const share = (s: number) => round1((s / seconds) * 100);
  return {
    app: app && was.has(pid) ? share(spent(app)) : null,
    tree: share(tree.reduce((sum, p) => sum + spent(p), 0)),
  };
}
