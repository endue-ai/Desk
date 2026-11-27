// `just test-pg-versions` (PG-101, ADR 0351): the database plugin's live tests against a real
// PostgreSQL of every supported major version, each in a throwaway container (pg-versions/server.mjs),
// one version after another, in three variants:
//   main  every live file as the superuser in a database of its own;
//   app   the files a role that is no superuser can run (APP_FILES), as such a role whose
//         search_path starts at a schema of its own;
//   cert  client-cert-live.test.ts on a database that only a TLS session with a client
//         certificate may reach (pg-versions/certs.mjs; skipped with a line when openssl is missing).
// It prints a table of each version and variant, removes every container it started (also on
// Ctrl-C) and exits 1 when a file failed that pg-versions/known.mjs does not expect. A machine with
// no container runtime skips with one line.
//   node scripts/pg-versions.mjs [--versions 17,18] [--variants main,app] [--docker <program>] [file...]
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { makeCerts, opensslMissing } from "./pg-versions/certs.mjs";
import { knownFailures, markKnown, toolMajor } from "./pg-versions/known.mjs";
import { CERT_ROLE, runtimeMissing, startServer, stopServer, uris } from "./pg-versions/server.mjs";

/**
 * The supported majors: those the PostgreSQL project still releases fixes for on 2026-11-22
 * (14's last release was in November 2026), the newest, 19, included. Change it with the README.
 */
export const SUPPORTED = [15, 16, 17, 18, 19];
export const VARIANTS = ["main", "app", "cert"];
const root = resolve(import.meta.dirname, "..");
const TESTS = "plugins/database/tests";

/**
 * The live files a role that is not a superuser runs as they are: the others set up what only a
 * superuser may (roles, tablespaces, databases, extensions, other roles' sessions).
 */
export const APP_FILES = [
  "live.test.ts",
  "schema-cache-live.test.ts",
  "complete-live.test.ts",
  "navigate-live.test.ts",
  "parse-live.test.ts",
  "plan-live.test.ts",
  "notice-live.test.ts",
  "grid-live.test.ts",
];

/** Every live file of the plugin, as paths from the repository root, in a stable order. */
export function liveFiles(dir = join(root, TESTS)) {
  return readdirSync(dir)
    .filter((file) => file === "live.test.ts" || file.endsWith("-live.test.ts"))
    .sort()
    .map((file) => `${TESTS}/${file}`);
}

/** The command line read: versions, variants, the Docker program and the files to run. */
export function parseArgs(argv) {
  const out = { versions: SUPPORTED, variants: VARIANTS, docker: "docker", files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "--versions") out.versions = value().split(",").map(Number);
    else if (arg === "--variants") out.variants = value().split(",");
    else if (arg === "--docker") out.docker = value();
    else if (arg.startsWith("--")) throw new Error(`unknown option ${arg}`);
    else out.files.push(arg);
  }
  for (const major of out.versions) {
    if (!SUPPORTED.includes(major)) throw new Error(`PostgreSQL ${major} is not supported`);
  }
  for (const variant of out.variants) {
    if (!VARIANTS.includes(variant)) throw new Error(`unknown variant ${variant}`);
  }
  return out;
}

/** What each variant runs and with which variables; none of the caller's server variables leak in. */
export function plan(variant, urls, files) {
  const pick = (all) => (files.length ? all.filter((f) => files.some((g) => f.endsWith(g))) : all);
  if (variant === "main")
    return { files: pick(liveFiles()), env: { ENDUE_DB_TEST_POSTGRES: urls.main } };
  if (variant === "app") {
    const app = APP_FILES.map((file) => `${TESTS}/${file}`);
    return { files: pick(app), env: { ENDUE_DB_TEST_POSTGRES: urls.app } };
  }
  const cert = [`${TESTS}/client-cert-live.test.ts`];
  return { files: pick(cert), env: { ENDUE_DB_TEST_POSTGRES_CLIENT_CERT: urls.cert ?? "" } };
}

/** The environment a run gets: the caller's, without any database URI, plus the variant's. */
export function runEnv(base, own) {
  const env = { ...base };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ENDUE_DB_TEST_") && key !== "ENDUE_DB_TEST_BRIDGE") delete env[key];
  }
  return { ...env, ...own };
}

function runVitestFile(file, env, report) {
  const cli = join(root, "node_modules/vitest/vitest.mjs");
  const args = [cli, "run", "--no-file-parallelism", "--reporter=default", "--reporter=json"];
  args.push(`--outputFile.json=${report}`, file);
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", () => done(1));
    child.once("close", (code) => done(code ?? 1));
  });
}

/** Wait for each file's process and teardown before another file uses the same database. */
export async function runLiveFiles(files, env, reportPrefix, runFile = runVitestFile) {
  const states = {};
  for (const file of files) {
    const report = `${reportPrefix}-${basename(file)}.json`;
    const code = await runFile(file, env, report);
    states[file] = code === 0 ? readReport(report, [file])[file] : "failed";
  }
  return states;
}

/** Each file's state: "passed", "failed" or "skipped" (every test skipped). A missing report fails all. */
export function readReport(path, files) {
  if (!existsSync(path)) return Object.fromEntries(files.map((file) => [file, "failed"]));
  const json = JSON.parse(readFileSync(path, "utf8"));
  const states = {};
  for (const result of json.testResults ?? []) {
    const file = files.find((f) => result.name.endsWith(f)) ?? result.name;
    const tests = result.assertionResults ?? [];
    const failed = result.status === "failed" || tests.some((t) => t.status === "failed");
    const skipped =
      tests.length > 0 && tests.every((t) => t.status !== "passed" && t.status !== "failed");
    states[file] = failed ? "failed" : skipped ? "skipped" : "passed";
  }
  for (const file of files) states[file] ??= "failed";
  return states;
}

/** The table printed at the end: one row per version and variant, failed and known files named. */
export function table(rows) {
  const lines = [
    "| PostgreSQL | Variant | Passed | Skipped | Failed | Known | Failed or known files |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const { version, variant, states, note, known = {} } of rows) {
    const all = Object.entries(states);
    const count = (state) => all.filter(([, s]) => s === state).length;
    const named = all
      .filter(([, s]) => s === "failed" || s === "known")
      .map(([f, s]) => (s === "known" ? `${basename(f)} (known: ${known[f]})` : basename(f)));
    const cells = [version, variant, count("passed"), count("skipped"), count("failed")];
    cells.push(count("known"), note ?? named.join(", "));
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

async function main(argv) {
  const options = parseArgs(argv);
  const missing = runtimeMissing(options.docker);
  if (missing) {
    console.log(`pg-versions: skipped, ${missing}`);
    return 0;
  }
  const work = mkdtempSync(join(tmpdir(), "desk-pg-versions-"));
  const started = new Set();
  const stopAll = () => {
    for (const server of started) stopServer(server);
    started.clear();
  };
  const interrupted = () => {
    stopAll();
    rmSync(work, { recursive: true, force: true });
    process.exit(130);
  };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  const rows = [];
  const pgDump = toolMajor("pg_dump");
  try {
    const noCert = options.variants.includes("cert") ? opensslMissing() : "";
    const tls =
      options.variants.includes("cert") && !noCert
        ? makeCerts(join(work, "tls"), CERT_ROLE)
        : undefined;
    for (const major of options.versions) {
      const name = `desk-pg-versions-${major}-${randomBytes(3).toString("hex")}`;
      let server;
      try {
        server = startServer({
          docker: options.docker,
          image: `postgres:${major}-alpine`,
          name,
          tls,
        });
      } catch (error) {
        console.error(`pg-versions: PostgreSQL ${major} did not start: ${error.message}`);
        rows.push({ version: String(major), variant: "server", states: { start: "failed" } });
        continue;
      }
      started.add(server);
      const urls = uris(server, tls);
      console.log(`\npg-versions: PostgreSQL ${server.version} in ${name}`);
      for (const variant of options.variants) {
        const version = server.version;
        if (variant === "cert" && noCert) {
          rows.push({ version, variant, states: {}, note: `skipped: ${noCert}` });
          continue;
        }
        const { files, env } = plan(variant, urls, options.files);
        if (!files.length) continue;
        console.log(`pg-versions: ${variant}, ${files.length} files`);
        const reportPrefix = join(work, `${major}-${variant}`);
        const known = knownFailures(major, pgDump);
        const states = markKnown(
          await runLiveFiles(files, runEnv(process.env, env), reportPrefix),
          known,
        );
        rows.push({ version, variant, states, known });
      }
      stopServer(server);
      started.delete(server);
    }
  } finally {
    stopAll();
    rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${table(rows)}`);
  return rows.some((row) => Object.values(row.states).includes("failed")) ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`pg-versions: ${error.message}`);
      process.exit(2);
    },
  );
}
