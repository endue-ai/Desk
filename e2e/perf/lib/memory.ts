// The app's memory from `ps -A -o pid=,ppid=,rss=,comm=`: the app is found under the tauri-driver
// that launched it, and its RSS is summed with its descendants' (WebKit's web and network
// processes). Pure: memory.test.ts.
import { round1 } from "./stats";

export interface Proc {
  pid: number;
  ppid: number;
  rssKb: number;
  name: string;
}

/** The processes in `ps` output; lines that are not `pid ppid rss name` are passed over. */
export function parsePs(text: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const [, pid, ppid, rss, name] = match;
    procs.push({ pid: Number(pid), ppid: Number(ppid), rssKb: Number(rss), name: name as string });
  }
  return procs;
}

/** `pid` and every process under it, parents before children. */
export function treeOf(procs: readonly Proc[], pid: number): Proc[] {
  const root = procs.find((p) => p.pid === pid);
  if (!root) return [];
  const tree = [root];
  for (let i = 0; i < tree.length; i++) {
    const parent = tree[i] as Proc;
    tree.push(...procs.filter((p) => p.ppid === parent.pid && p.pid !== parent.pid));
  }
  return tree;
}

/** The first process named `name` under `root` (not `root` itself), nearest first. */
export function findUnder(procs: readonly Proc[], root: number, name: string): Proc | undefined {
  return treeOf(procs, root)
    .slice(1)
    .find((p) => p.name === name);
}

/** The summed RSS of `procs` in MB (MiB), one decimal. */
export function rssMb(procs: readonly Proc[]): number {
  return round1(procs.reduce((sum, p) => sum + p.rssKb, 0) / 1024);
}
