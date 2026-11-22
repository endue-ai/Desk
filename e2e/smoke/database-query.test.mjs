// node --test e2e/smoke/database-query.test.mjs: the install smoke's database step without a desk.
// The seed's files and where they go on each OS, the password file's mode, the Windows gap said in
// one line, and an answer without the row failing. Fixture values only.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  answered,
  CONNECTION,
  dataDir,
  PLUGIN,
  run,
  SQL,
  seed,
  seedFiles,
  serverOf,
  WINDOWS_GAP,
} from "./database-query.mjs";

const SERVER = serverOf("postgresql://app@db.example.test:6543/shop", "pa:ss\\word");

test("the server comes from the URI, the password from PGPASSWORD before the URI's", () => {
  assert.deepEqual(SERVER, {
    host: "db.example.test",
    port: 6543,
    database: "shop",
    user: "app",
    password: "pa:ss\\word",
  });
  assert.equal(serverOf("postgres://u:p@h/d").password, "p");
  assert.equal(serverOf("postgresql://h").port, 5432);
  assert.throws(() => serverOf("mysql://h/d"), /postgresql/u);
});

test("the data folder is the desk's on each OS", () => {
  assert.equal(dataDir("darwin", "/h", {}), "/h/Library/Application Support/ai.endue.desk");
  assert.equal(dataDir("linux", "/h", {}), "/h/.local/share/ai.endue.desk");
  assert.equal(dataDir("linux", "/h", { XDG_DATA_HOME: "/x" }), "/x/ai.endue.desk");
  assert.match(dataDir("win32", "/h", { APPDATA: "/r" }), /^\/r.ai\.endue\.desk$/u);
});

test("the seed holds the plugin's connection, a lasting db:connect grant and an escaped password line", () => {
  const files = seedFiles(SERVER, new Date("2026-01-02T03:04:05Z"));
  const store = JSON.parse(files["store.json"]);
  assert.deepEqual(store[PLUGIN].connections, [
    {
      id: "c-smoke00001",
      engine: "postgresql",
      name: CONNECTION,
      host: "db.example.test",
      port: 6543,
      database: "shop",
      user: "app",
    },
  ]);
  assert.ok(!files["store.json"].includes("word"), "no password in the store");
  assert.deepEqual(JSON.parse(files["grants.json"]), {
    version: 1,
    grants: [
      {
        caller: PLUGIN,
        grant: {
          grantId: "g-smoke-db",
          permission: { permission: "db:connect", hosts: ["db.example.test:6543"] },
          duration: "always",
          grantedAt: "2026-01-02T03:04:05.000Z",
        },
      },
    ],
  });
  assert.equal(files.pgpass, "db.example.test:6543:shop:app:pa\\:ss\\\\word\n");
});

test("the seed writes its files where the desk reads them, the password file for its owner only", () => {
  const home = mkdtempSync(join(tmpdir(), "desk-smoke-db-"));
  try {
    const pgpass = seed(home, SERVER, "linux");
    const data = join(home, ".local", "share", "ai.endue.desk");
    assert.ok(JSON.parse(readFileSync(join(data, "store.json"), "utf8"))[PLUGIN]);
    assert.ok(JSON.parse(readFileSync(join(data, "grants.json"), "utf8")).grants);
    if (process.platform !== "win32") assert.equal(statSync(pgpass).mode & 0o077, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Windows says it skipped, in one line, without calling the CLI", async () => {
  const calls = [];
  const said = await run("desk", "win32", (...args) => {
    calls.push(args);
    return { status: 0, answer: {}, text: "" };
  });
  assert.equal(said, WINDOWS_GAP);
  assert.equal(calls.length, 0);
});

test("the query step opens the plugin, waits for its query command and needs the row", async () => {
  const calls = [];
  const answers = {
    open: { status: 0, answer: { ok: true }, text: "" },
    list: { status: 0, answer: { result: { commands: [{ id: `${PLUGIN}.query` }] } }, text: "" },
    query: {
      status: 0,
      answer: { result: { statements: [{ results: [{ columns: ["answer"], rows: [[42]] }] }] } },
      text: "",
    },
  };
  const fake = (_program, args) => {
    calls.push(args);
    if (args[1] === "list") return answers.list;
    return args[2] === `${PLUGIN}.open` ? answers.open : answers.query;
  };
  assert.match(await run("desk", "linux", fake), /answered 42/u);
  assert.deepEqual(calls.at(-1), [
    "cmd",
    "run",
    `${PLUGIN}.query`,
    "--args",
    JSON.stringify({ connection: CONNECTION, sql: SQL }),
    "--timeout",
    "60",
  ]);
  answers.query = { status: 0, answer: { result: { statements: [{ results: [{ rows: [[41]] }] }] } }, text: "41" };
  await assert.rejects(run("desk", "linux", fake), /did not answer 42/u);
  assert.equal(answered({ rows: [{ answer: "42" }] }), true);
  assert.equal(answered({ result: "42" }), false);
});
