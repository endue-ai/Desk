#!/usr/bin/env node
// The install smoke's database step (PG-102): the database plugin opened and one query run on a real
// PostgreSQL server, through the desk CLI over the desk socket, as a person's script would.
//   node e2e/smoke/database-query.mjs seed <home>   before the desk starts: prints PGPASSFILE=<file>
//   node e2e/smoke/database-query.mjs run <cli>     once it is ready: exits 0 when the row came back
// DESK_SMOKE_POSTGRES names the server (postgresql://user@host:port/database); its password comes
// from PGPASSWORD (or the URI) and goes only into a password file the seed writes, mode 0600, which
// the core reads as libpq does (PGPASSFILE). The seed writes, in the data folder the desk uses under
// that home, the plugin's connection `smoke` (store.json) and a lasting db:connect grant for that
// host and port (grants.json, ADR 0029), so nothing asks. Windows has no desk socket yet
// (crates/desk-ipc), so there `run` says it skipped and exits 0; the seed still runs.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const PLUGIN = "endue.database";
export const CONNECTION = "smoke";
export const SQL = "select 41 + 1 as answer";
export const WINDOWS_GAP =
  "smoke: database query skipped on Windows: the desk socket the CLI talks to is not built there yet";

/** The server DESK_SMOKE_POSTGRES names, the password from PGPASSWORD or the URI. */
export function serverOf(/** @type {string} */ uri, password = "") {
  const url = new URL(uri);
  if (!/^postgres(ql)?:$/u.test(url.protocol))
    throw new Error("DESK_SMOKE_POSTGRES: a postgresql:// URI");
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)) || "postgres",
    user: decodeURIComponent(url.username) || "postgres",
    password: password || decodeURIComponent(url.password),
  };
}

/** The desk's data folder under `home` on `platform` (apps/desk/shell/src/paths.rs). */
export function dataDir(
  /** @type {string} */ platform,
  /** @type {string} */ home,
  env = process.env,
) {
  if (platform === "darwin")
    return join(home, "Library", "Application Support", "ai.endue.desktop");
  if (platform === "win32")
    return join(env.APPDATA || join(home, "AppData", "Roaming"), "ai.endue.desktop");
  return join(env.XDG_DATA_HOME || join(home, ".local", "share"), "ai.endue.desktop");
}

/** One field of a password file line: `:` and `\` escaped, as libpq reads it. */
const pgpassField = (/** @type {string | number} */ value) =>
  String(value).replace(/[\\:]/gu, "\\$&");

/** What the seed writes: file name to text. */
export function seedFiles(/** @type {ReturnType<typeof serverOf>} */ server, at = new Date()) {
  const connection = {
    id: "c-smoke00001",
    engine: "postgresql",
    name: CONNECTION,
    host: server.host,
    port: server.port,
    database: server.database,
    user: server.user,
  };
  const grant = {
    grantId: "g1",
    permission: { permission: "db:connect", hosts: [`${server.host}:${server.port}`] },
    duration: "always",
    grantedAt: at.toISOString(),
  };
  const line = [server.host, server.port, server.database, server.user, server.password]
    .map(pgpassField)
    .join(":");
  return {
    "store.json": `${JSON.stringify({ [PLUGIN]: { connections: [connection] } })}\n`,
    "grants.json": `${JSON.stringify({ version: 1, nextId: 2, grants: [{ caller: PLUGIN, grant }] })}\n`,
    pgpass: `${line}\n`,
  };
}

/** Write the seed under `home`; answers the password file's path. */
export function seed(
  /** @type {string} */ home,
  /** @type {ReturnType<typeof serverOf>} */ server,
  platform = process.platform,
) {
  const data = dataDir(platform, home);
  mkdirSync(data, { recursive: true });
  const files = seedFiles(server);
  const pgpass = join(home, "smoke.pgpass");
  for (const [name, text] of Object.entries(files)) {
    const path = name === "pgpass" ? pgpass : join(data, name);
    writeFileSync(path, text, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  return pgpass;
}

/** Whether a `desk --json cmd run` answer holds the row 42 under some `rows`. */
export function answered(/** @type {unknown} */ value) {
  if (Array.isArray(value)) return value.some(answered);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, inner]) =>
    key === "rows" && Array.isArray(inner)
      ? inner.some((row) =>
          (Array.isArray(row) ? row : Object.values(row ?? {})).some((v) => `${v}` === "42"),
        )
      : answered(inner),
  );
}

/** One CLI call: its answer line parsed, or the failure. */
function cli(/** @type {string} */ program, /** @type {string[]} */ args) {
  const done = spawnSync(program, ["--json", ...args], { encoding: "utf8", timeout: 90_000 });
  const line = (done.stdout || "").trim().split("\n").at(-1) || "";
  let answer;
  try {
    answer = JSON.parse(line);
  } catch {
    answer = undefined;
  }
  return { status: done.status, answer, text: `${done.stdout || ""}${done.stderr || ""}`.trim() };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** Open the plugin, wait for its query command, run the query; throws what failed. */
export async function run(/** @type {string} */ program, platform = process.platform, call = cli) {
  if (platform === "win32") return WINDOWS_GAP;
  const opened = call(program, ["cmd", "run", `${PLUGIN}.open`]);
  if (opened.status !== 0) throw new Error(`${PLUGIN}.open failed: ${opened.text}`);
  for (let tries = 0; ; tries++) {
    const listed = call(program, ["cmd", "list"]);
    if (JSON.stringify(listed.answer ?? "").includes(`"${PLUGIN}.query"`)) break;
    if (tries >= 60) throw new Error(`${PLUGIN}.query was not registered within 30 s`);
    await sleep(500);
  }
  const args = JSON.stringify({ connection: CONNECTION, sql: SQL });
  const query = call(program, ["cmd", "run", `${PLUGIN}.query`, "--args", args, "--timeout", "60"]);
  if (query.status !== 0 || !answered(query.answer))
    throw new Error(`the query did not answer 42: ${query.text}`);
  return `smoke: database query answered 42 through ${PLUGIN}`;
}

async function main(/** @type {string[]} */ argv) {
  const [step, target] = argv;
  const uri = process.env.DESK_SMOKE_POSTGRES;
  if (!uri) throw new Error("DESK_SMOKE_POSTGRES is not set");
  if (step === "seed" && target) {
    console.log(`PGPASSFILE=${seed(target, serverOf(uri, process.env.PGPASSWORD))}`);
  } else if (step === "run" && target) {
    console.log(await run(target));
  } else {
    throw new Error("usage: database-query.mjs seed <home> | run <cli>");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      `smoke: database query failed: ${error instanceof Error ? error.message : error}`,
    );
    process.exit(1);
  });
}
