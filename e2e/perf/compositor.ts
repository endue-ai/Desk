// The compositor's performance (`just perf-compositor [check|record]`, #58): the compose bench
// (15 surfaces at 2560x1440, and the compositor's own start), then the shell's surface probe on the
// CEF desk (memory per live surface, the start to the first composed web surface, a press to its
// paint and to the composed frame holding it). Each writes what
// it measured into e2e/test-results/perf-compositor; this merges it, judges it against
// e2e/perf/budgets.json (lib/compositor.ts), prints the verdicts and writes results.json. "record"
// makes this run's values the baselines instead. Needs `just build-shell` once (the web runtime the
// bundle carries); the shell's test build comes first and the bundle is laid out after it, since a
// bundle older than the binary makes the probe tests skip. A quiet machine; Node strips the types.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Budgets, compare, failed, report, withBaselines } from "./lib/compositor.ts";
import { merge } from "./lib/results.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const BUDGETS = join(here, "budgets.json");
const OUT = join(root, "e2e/test-results/perf-compositor");
const mode = process.argv[2] ?? "check";

if (mode !== "check" && mode !== "record") {
  console.error(`perf-compositor: mode is check or record, not ${mode}`);
  process.exit(2);
}

function run(command: string, args: string[], env: Record<string, string> = {}): boolean {
  console.log(`perf-compositor: ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, CARGO_INCREMENTAL: "0", DESK_PERF_OUT: OUT, ...env },
  });
  return result.status === 0;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const steps = [
  run("cargo", ["bench", "-p", "desk-compositor", "--bench", "compose"]),
  run("cargo", ["test", "-p", "desk-shell", "--test", "budgets", "--no-run"]),
];
if (process.platform === "darwin") {
  rmSync(join(root, "target/bundle/endue-desk-cef.app"), { recursive: true, force: true });
  steps.push(
    run("cargo", [
      "run",
      "-q",
      "-p",
      "desk-shell",
      "--features",
      "bundle",
      "--bin",
      "desk-shell-bundle",
      "--",
      "target/bundle",
      "debug",
    ]),
  );
}
steps.push(
  run(
    "cargo",
    ["test", "-p", "desk-shell", "--test", "budgets", "--", "--ignored", "--test-threads=1"],
    { DESK_SHELL_REQUIRE_PROBE: "1" },
  ),
);

const parts = readdirSync(OUT)
  .filter((file) => file.endsWith(".measured.json"))
  .map((file) => JSON.parse(readFileSync(join(OUT, file), "utf8")) as unknown);
const measured = merge(parts) as Budgets;
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8")) as Budgets;
const verdicts = compare(budgets, measured);
const date = new Date().toISOString();
writeFileSync(
  join(OUT, "results.json"),
  `${JSON.stringify({ version: 1, date, measured, verdicts, failed: failed(verdicts) }, null, 2)}\n`,
);
console.log(report(verdicts));
const recorded = `${JSON.stringify(withBaselines(budgets, measured, { recorded: date.slice(0, 10) }), null, 2)}\n`;
if (mode === "record") {
  writeFileSync(BUDGETS, recorded);
  console.log("perf-compositor: this run's values are the baselines now (e2e/perf/budgets.json)");
} else {
  writeFileSync(join(OUT, "budgets.json"), recorded);
}
if (steps.some((ok) => !ok)) {
  console.error("perf-compositor: a measurement failed (its output is above)");
  process.exit(1);
}
if (mode === "check" && failed(verdicts)) {
  console.error("perf-compositor: a value is past its budget or out of its band (the table above)");
  process.exit(1);
}
