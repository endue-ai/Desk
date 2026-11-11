/**
 * Undo of a pack (ADR 0108): what its Apply did, taken back in an order that keeps the way back. The
 * profile first, back to the one in force before: the pack contributes its profile, and turning the
 * pack off takes it away. Then the plugins Apply turned on (what the pack brings, what its profile
 * turned on, the pack last) go off again, those its profile turned off come back on, and a pack Apply
 * installed from a market is removed with what it nests. What was on before stays on.
 */
import type { PluginInfo } from "@endue-ai/bridge";
import type { PackDeps } from "./pack";

const SCOPE = { permission: "plugin:manage" } as const;

/** What one Apply of a pack changed. */
export interface PackApplied {
  pack: string;
  /** What the person calls it: GitHub. */
  title: string;
  /** Apply installed it from a market. */
  installed: boolean;
  /** The profile Apply switched to. */
  profile?: string;
  /** The profile in force and the plugins on before Apply. */
  before: { profile?: string; on: string[] };
  /** The plugins on once Apply was done. */
  after: string[];
}

/** The plugins on, by id. */
export const enabledOn = (plugins: PluginInfo[]): string[] =>
  plugins.filter((p) => p.enabled).map((p) => p.id);

/** Take back what `applied` did, take the card away and say so; a step that fails is named. */
export async function takeBack(deps: PackDeps, applied: PackApplied): Promise<void> {
  const { bridge, commands } = deps;
  const problems: string[] = [];
  const step = (work: () => Promise<unknown>) =>
    work().catch((error: unknown) => {
      problems.push(error instanceof Error ? error.message : String(error));
    });
  const setEnabled = (plugin: string, enabled: boolean) =>
    step(() => bridge.call("plugin.setEnabled", { plugin, enabled, scope: SCOPE }));
  const { before, after, pack } = applied;
  const back = before.profile ?? "default";
  if (applied.profile && applied.profile !== back) {
    const now = (await commands.run("desk.profiles.list").catch(() => undefined)) as
      | { active?: string }
      | undefined;
    if (now?.active === applied.profile)
      await step(() => commands.run("desk.profiles.switch", { id: back }));
  }
  const was = new Set(before.on);
  const is = new Set(after);
  for (const id of after.filter((id) => !was.has(id) && id !== pack)) await setEnabled(id, false);
  if (is.has(pack) && !was.has(pack)) await setEnabled(pack, false);
  for (const id of before.on.filter((id) => !is.has(id))) await setEnabled(id, true);
  if (applied.installed)
    await step(() => bridge.call("plugin.remove", { plugin: pack, scope: SCOPE }));
  deps.card.close();
  deps.notify(
    problems.length
      ? {
          caller: "desk",
          title: `Could not take back all of the ${applied.title} pack`,
          body: problems.join("; "),
          level: "error",
        }
      : { caller: "desk", title: `Took back the ${applied.title} pack`, level: "info" },
  );
}
