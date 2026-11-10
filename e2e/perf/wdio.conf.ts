// The app's performance (`just perf-app`): start-up, idle memory, input latency and a fresh desk at
// rest on the app, WebdriverIO as in the app e2e (../wdio.conf.ts): the desk over chromedriver.
// Each spec file starts the app with a fresh HOME, the Default profile without the first run (the
// rest spec's with it, #134) and without the e2e dev plugin, and keeps what it measured in
// e2e/test-results/perf. Once all ran, onComplete writes results.json there, prints the verdicts
// against budgets.json beside the RT-16 targets, and fails when a value is past its baseline's
// allowance or its budget. Without a baseline nothing
// fails and a budgets.json holding this run's values is left beside results.json for a person to
// commit; PERF_MODE=record writes it into e2e/perf/budgets.json instead.
import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import { saveData, startDriver } from "../support/driver";
import { config as e2e } from "../wdio.conf";
import { type Budgets, compare, failed, report, withBaselines } from "./lib/budgets";
import { merge, results } from "./lib/results";
import { keep, MEASURED, OUT } from "./support/out";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const BUDGETS = join(here, "budgets.json");

/** The app's variables per spec file: the start-up spec keeps a trace of every start. */
const ENV: Record<string, Record<string, string | undefined>> = {
  "startup.perf.ts": { DESK_DEV_PLUGINS: undefined, DESK_TRACE: "1" },
};
const DEFAULT_ENV = { DESK_DEV_PLUGINS: undefined };
/** The init.yaml in e2e/fixtures per spec file: the rest spec goes through the first run. */
const INIT: Record<string, string> = { "rest.perf.ts": "init.yaml" };

let spec = "spec";
const specName = (file: string | undefined) =>
  basename(file?.startsWith("file:") ? fileURLToPath(file) : (file ?? "spec"));

/** Merge what the spec files measured, judge it against budgets.json, and say so. */
function verdict(): void {
  const parts = readdirSync(OUT)
    .filter((file) => file.endsWith(MEASURED))
    .map((file) => JSON.parse(readFileSync(join(OUT, file), "utf8")) as unknown);
  const measured = merge(parts);
  const budgets = JSON.parse(readFileSync(BUDGETS, "utf8")) as Budgets;
  const verdicts = compare(budgets, measured);
  const date = new Date().toISOString();
  const platform = `${process.platform}-${process.arch}`;
  keep(
    "results.json",
    results(measured, verdicts, { date, platform, commit: process.env.GITHUB_SHA ?? null }),
  );
  const text = report(verdicts);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`\n${text}\n\`\`\`\n`);
  }
  const recorded = `${JSON.stringify(withBaselines(budgets, measured, { platform, recorded: date.slice(0, 10) }), null, 2)}\n`;
  if (process.env.PERF_MODE === "record") {
    writeFileSync(BUDGETS, recorded);
    console.log("perf: this run's values are the baselines now (e2e/perf/budgets.json)");
  } else if (verdicts.some((v) => v.status === "no-baseline")) {
    writeFileSync(join(OUT, "budgets.json"), recorded);
    console.log(
      "perf: no baseline yet, so nothing failed. To record this run's values as the baseline, " +
        "commit budgets.json from the perf artifact (e2e/test-results/perf) as e2e/perf/budgets.json",
    );
  }
  if (failed(verdicts)) {
    throw new Error(
      "perf: a value is past its baseline's allowance (see the table and results.json)",
    );
  }
}

export const config: WebdriverIO.Config = {
  ...e2e,
  specs: ["./*.perf.ts"],
  // A retry would measure a second time and keep whichever finished last.
  specFileRetries: 0,
  // Idle memory waits five minutes.
  mochaOpts: { ui: "bdd", timeout: 10 * 60_000 },

  onPrepare() {
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });
  },
  async beforeSession(_config, capabilities, specs) {
    spec = specName(specs[0]);
    const results = join(root, "e2e/test-results");
    const env = ENV[spec] ?? DEFAULT_ENV;
    const init = INIT[spec] ?? "init-no-first-run.yaml";
    const extra = await startDriver({ root, results, spec, init, env });
    Object.assign(capabilities, extra);
  },
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const name = `${spec}-${test.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")}`;
    await browser.saveScreenshot(join(OUT, `${name}.png`)).catch(() => {});
    saveData(join(OUT, `${name}-data`));
  },
  onComplete() {
    verdict();
  },
};
