// What this start found (ADR 0061), from the app: safe mode and the state files kept broken, and how
// the desk starts again without safe mode. A host without the commands (an older app) starts normal.
import type { StartInfo } from "@endue-ai/runtime";

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The start information `desk_start` returns; an empty one when it cannot be read. */
export async function readStart(invoke: Invoke): Promise<StartInfo> {
  const info = (await invoke("desk_start").catch(() => undefined)) as
    | Partial<StartInfo>
    | undefined;
  return {
    broken: Array.isArray(info?.broken) ? info.broken : [],
    ...(info?.safe ? { safe: info.safe } : {}),
    ...(typeof info?.dataDir === "string" ? { dataDir: info.dataDir } : {}),
  };
}

/** Start the desk again without safe mode: the app quits once the new process is on its way. */
export function relauncher(invoke: Invoke): () => Promise<void> {
  return async () => {
    await invoke("desk_relaunch");
  };
}
