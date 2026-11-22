// `just test-pg-versions` (PG-101) without a container: the supported set as the README states it,
// the files each variant runs, the server variables a run never inherits, the report and table,
// the variants' roles and certificates, and the one line a machine with no container runtime prints.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  APP_FILES,
  liveFiles,
  parseArgs,
  plan,
  readReport,
  runEnv,
  SUPPORTED,
  table,
  VARIANTS,
} from "./pg-versions.mjs";
import { EXTENSIONS } from "./pg-versions/certs.mjs";
import { APP_ROLE, APP_SCHEMA, HBA_FIRST, setupSql } from "./pg-versions/server.mjs";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts/pg-versions.mjs");

test("the supported majors are 15 to 19, as the plugin's README states them", () => {
  assert.deepEqual(SUPPORTED, [15, 16, 17, 18, 19]);
  const readme = readFileSync(join(root, "plugins/database/README.md"), "utf8");
  assert.match(readme, new RegExp(`PostgreSQL ${SUPPORTED[0]} to ${SUPPORTED.at(-1)}`, "u"));
  assert.match(readme, /just test-pg-versions/u);
});

test("the justfile's recipe runs this script and TESTING.md says when", () => {
  const justfile = readFileSync(join(root, "justfile"), "utf8");
  assert.match(justfile, /\ntest-pg-versions \*args:\n {4}node scripts\/pg-versions\.mjs "\$@"\n/u);
  const testing = readFileSync(join(root, "docs/qa/TESTING.md"), "utf8");
  assert.match(testing, /\n\| Unit: database server versions \|.*just test-pg-versions/u);
});

test("main runs every live file; app a subset that exists; cert the certificate file alone", () => {
  const all = liveFiles();
  assert.ok(all.includes("plugins/database/tests/live.test.ts"));
  assert.ok(all.includes("plugins/database/tests/schema-cache-live.test.ts"));
  assert.ok(all.every((file) => file.endsWith("live.test.ts")));
  for (const file of APP_FILES) assert.ok(existsSync(join(root, "plugins/database/tests", file)), file);
  const urls = { main: "postgresql://m", app: "postgresql://a", cert: "postgresql://c" };
  assert.deepEqual(plan("main", urls, []), { files: all, env: { ENDUE_DB_TEST_POSTGRES: "postgresql://m" } });
  assert.equal(plan("app", urls, []).files.length, APP_FILES.length);
  assert.equal(plan("app", urls, []).env.ENDUE_DB_TEST_POSTGRES, "postgresql://a");
  assert.deepEqual(plan("cert", urls, []), {
    files: ["plugins/database/tests/client-cert-live.test.ts"],
    env: { ENDUE_DB_TEST_POSTGRES_CLIENT_CERT: "postgresql://c" },
  });
  assert.deepEqual(plan("main", urls, ["plan-live.test.ts"]).files, ["plugins/database/tests/plan-live.test.ts"]);
});

test("a run never inherits a server's URI, only the built bridge", () => {
  const env = runEnv(
    {
      PATH: "/bin",
      ENDUE_DB_TEST_POSTGRES: "postgresql://shared",
      ENDUE_DB_TEST_POSTGRES_CLIENT_CERT: "postgresql://shared-cert",
      ENDUE_DB_TEST_MYSQL: "mysql://shared",
      ENDUE_DB_TEST_BRIDGE: "/built/db-bridge",
    },
    { ENDUE_DB_TEST_POSTGRES: "postgresql://own" },
  );
  assert.deepEqual(env, {
    PATH: "/bin",
    ENDUE_DB_TEST_BRIDGE: "/built/db-bridge",
    ENDUE_DB_TEST_POSTGRES: "postgresql://own",
  });
});

test("the options are checked: an unsupported major or variant is refused", () => {
  assert.deepEqual(parseArgs([]), { versions: SUPPORTED, variants: VARIANTS, docker: "docker", files: [] });
  assert.deepEqual(parseArgs(["--versions", "17,18", "--variants", "main", "x.test.ts"]), {
    versions: [17, 18],
    variants: ["main"],
    docker: "docker",
    files: ["x.test.ts"],
  });
  assert.throws(() => parseArgs(["--versions", "13"]), /PostgreSQL 13 is not supported/u);
  assert.throws(() => parseArgs(["--variants", "pooler"]), /unknown variant pooler/u);
  assert.throws(() => parseArgs(["--versions"]), /needs a value/u);
});

test("the report gives each file passed, failed or skipped, a missing file failed", () => {
  const dir = mkdtempSync(join(tmpdir(), "pg-versions-test-"));
  try {
    const path = join(dir, "report.json");
    const files = ["t/a-live.test.ts", "t/b-live.test.ts", "t/c-live.test.ts", "t/d-live.test.ts"];
    writeFileSync(
      path,
      JSON.stringify({
        testResults: [
          { name: "/x/t/a-live.test.ts", status: "passed", assertionResults: [{ status: "passed" }] },
          { name: "/x/t/b-live.test.ts", status: "failed", assertionResults: [{ status: "failed" }] },
          { name: "/x/t/c-live.test.ts", status: "passed", assertionResults: [{ status: "skipped" }] },
        ],
      }),
    );
    const states = readReport(path, files);
    assert.deepEqual(states, {
      "t/a-live.test.ts": "passed",
      "t/b-live.test.ts": "failed",
      "t/c-live.test.ts": "skipped",
      "t/d-live.test.ts": "failed",
    });
    assert.deepEqual(readReport(join(dir, "none.json"), ["t/a"]), { "t/a": "failed" });
    const printed = table([{ version: "18.1", variant: "main", states }]);
    assert.match(printed, /\| 18\.1 \| main \| 1 \| 1 \| 2 \| b-live\.test\.ts, d-live\.test\.ts \|/u);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the app variant's role is no superuser and starts its search_path at its own schema", () => {
  const sql = setupSql("pw").join(";\n");
  assert.match(sql, new RegExp(`CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE`, "u"));
  assert.match(sql, new RegExp(`SET search_path = ${APP_SCHEMA}, public`, "u"));
  assert.match(HBA_FIRST[0], /^hostssl desk_versions_cert all all cert$/u);
  assert.match(HBA_FIRST[1], /^host desk_versions_cert all all reject$/u);
  assert.match(EXTENSIONS, /\[ca\]\nbasicConstraints = critical, CA:TRUE/u);
  assert.match(EXTENSIONS, /subjectAltName = IP:127\.0\.0\.1/u);
});

test("with no container runtime the run is skipped with one line", () => {
  const run = spawnSync(process.execPath, [script, "--docker", "/nonexistent/docker"], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "pg-versions: skipped, no container runtime (/nonexistent/docker is not installed)\n");
});
