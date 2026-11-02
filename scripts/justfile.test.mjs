// The justfile's recipes as the guides use them, through `just --dry-run`: nothing here starts the app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const APP = "pnpm --filter @endue-ai/desk-app tauri dev";
const missing = spawnSync("just", ["--version"]).error;
const skip = missing ? `just is not installed (${missing.message}); CI runs this test` : false;

/** The command `just dev` would run, as `just --dry-run` prints it, with the environment given. */
function dryRun(env) {
  const base = { ...process.env };
  delete base.DESK_DEV_PLUGINS;
  const run = spawnSync("just", ["--justfile", join(root, "justfile"), "--dry-run", "dev"], {
    cwd: root,
    env: { ...base, ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return `${run.stdout}${run.stderr}`.trim();
}

/** The variables that command hands the app: bash runs it with `env` in place of the app. */
function appEnv(command) {
  assert.ok(command.endsWith(APP), `just dev no longer runs "${APP}":\n${command}`);
  const run = spawnSync("bash", ["-c", `${command.slice(0, -APP.length)} env -0`], {
    env: { PATH: process.env.PATH },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return Object.fromEntries(
    run.stdout
      .split("\0")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

test("just dev loads examples/plugin-hello-ui when DESK_DEV_PLUGINS is unset", { skip }, () => {
  const env = appEnv(dryRun({}));
  assert.equal(env.DESK_DEV_PLUGINS, join(root, "examples/plugin-hello-ui"));
  assert.equal(env.DESK_PLUGIN_DIRS, join(root, "plugins"));
});

test("just dev loads the dev plugin folder the caller names in DESK_DEV_PLUGINS", { skip }, () => {
  for (const folder of ["/some/folder", "/tmp/my plugins/a $HOME 'theme'"]) {
    const env = appEnv(dryRun({ DESK_DEV_PLUGINS: folder }));
    assert.equal(env.DESK_DEV_PLUGINS, folder);
    assert.equal(env.DESK_PLUGIN_DIRS, join(root, "plugins"));
  }
});
