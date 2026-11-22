// Before a run of `just perf-database`: the results of the last run go, so results.json holds this one's.
import { rmSync } from "node:fs";

export default function fresh() {
  rmSync(new URL("../../test-results/perf-database/", import.meta.url), {
    recursive: true,
    force: true,
  });
}
