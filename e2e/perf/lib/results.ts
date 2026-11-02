// results.json, which the perf job uploads: what each spec file measured, merged, with the
// verdicts against budgets.json. Pure: results.test.ts.
import type { Measured, Verdict } from "./budgets";

export const RESULTS_VERSION = 1;

/** The spec files' results (`{ <section>: {...} }` each) as one; a later file's section wins. */
export function merge(parts: readonly unknown[]): Measured {
  const measured: Record<string, Record<string, unknown>> = {};
  for (const part of parts) {
    if (typeof part !== "object" || part === null) continue;
    for (const [section, values] of Object.entries(part)) {
      if (typeof values === "object" && values !== null && !Array.isArray(values)) {
        measured[section] = values as Record<string, unknown>;
      }
    }
  }
  return measured as Measured;
}

export interface Meta {
  /** ISO time of the run. */
  date: string;
  /** `process.platform-process.arch`. */
  platform: string;
  /** The commit measured, when known (GITHUB_SHA). */
  commit: string | null;
}

export function results(measured: Measured, verdicts: readonly Verdict[], meta: Meta) {
  return {
    version: RESULTS_VERSION,
    ...meta,
    measured,
    verdicts: verdicts.map(({ section, key, unit, value, baseline, limit, target, status }) => ({
      name: `${section}.${key}`,
      unit,
      value,
      baseline,
      limit,
      target,
      status,
    })),
    failed: verdicts.some((verdict) => verdict.status === "over"),
  };
}
