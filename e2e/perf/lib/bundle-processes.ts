// The processes that run from one app bundle, read from `ps -axww -o pid=,ppid=,command=`: the motion
// gate's desks, a desk one of them started again for a stall (ADR 0202) and their helpers, whatever
// their parent is now (launchd, pid 1, once the desk that started them quit). Pure:
// bundle-processes.test.ts.

/** A process, its parent and its command line. */
export interface BundleProcess {
  pid: number;
  ppid: number;
  command: string;
}

/** The lines of `ps` whose command runs from the bundle `app` (its `.app` folder). */
export function ofBundle(ps: string, app: string): BundleProcess[] {
  const folder = app.endsWith("/") ? app : `${app}/`;
  return ps.split("\n").flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    const command = m?.[3] ?? "";
    if (!m || !command.startsWith(folder)) return [];
    return [{ pid: Number(m[1]), ppid: Number(m[2]), command }];
  });
}

/** The processes as the gate reports them: pid, parent and the command from the bundle on. */
export function described(processes: BundleProcess[], app: string): string {
  const folder = app.endsWith("/") ? app : `${app}/`;
  return processes
    .map((p) => `${p.pid} (parent ${p.ppid}) ${p.command.slice(folder.length).slice(0, 80)}`)
    .join("; ");
}
