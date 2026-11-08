// Where the perf runner keeps what it measured: e2e/test-results/perf, the job's artifact. Each
// spec file writes `<name>.measured.json`; wdio.conf.ts merges them into results.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../test-results/perf");
export const MEASURED = ".measured.json";

/** Keep a JSON document in OUT. */
export function keep(file: string, value: unknown): void {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, file), `${JSON.stringify(value, null, 2)}\n`);
}

/** What one spec file measured, by budgets.json section. */
export function measured(name: string, sections: Record<string, Record<string, unknown>>): void {
  keep(`${name}${MEASURED}`, sections);
}
