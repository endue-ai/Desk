// The justfile's recipes as the guides use them, through `just --dry-run`: nothing here starts the app.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
/** The CEF desk `just dev` runs (#97): the macOS bundle's binary, else the debug build. */
const MAC = "exec target/bundle/endue-desk.app/Contents/MacOS/endue-desk";
const DEBUG = "exec target/debug/endue-desk";
const missing = spawnSync("just", ["--version"]).error;
const skip = missing ? `just is not installed (${missing.message}); CI runs this test` : false;

/** What `just <recipe>` would run, as `just --dry-run` prints it, with the environment given. */
function dryRun(env, recipe = "dev", deps = false) {
  const base = { ...process.env };
  delete base.DESK_DEV_PLUGINS;
  const args = ["--justfile", join(root, "justfile"), "--dry-run", ...(deps ? [] : ["--no-deps"])];
  const run = spawnSync("just", [...args, recipe], {
    cwd: root,
    env: { ...base, ...env },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return `${run.stdout}${run.stderr}`.trim();
}

/** The variables that script hands the app: bash runs its exports with `env` in place of the app. */
function appEnv(script) {
  const lines = script.split("\n");
  assert.ok(
    lines.some((line) => line.includes(MAC)),
    `just dev no longer runs ${MAC}:\n${script}`,
  );
  assert.equal(lines.at(-1), DEBUG, `just dev no longer ends with ${DEBUG}:\n${script}`);
  const exports = lines.filter((line) => line.startsWith("export ")).join("\n");
  const run = spawnSync("bash", ["-c", `${exports}\nenv -0`], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return Object.fromEntries(
    run.stdout
      .split("\0")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

// just joins its own paths with "/", so on Windows they mix separators: compare them resolved.
test("just dev loads plugin-hello-ui and plugin-hello-view by default", { skip }, () => {
  const env = appEnv(dryRun({}));
  const folders = env.DESK_DEV_PLUGINS.split(delimiter).map((folder) => resolve(folder));
  assert.deepEqual(folders, [
    join(root, "examples/plugin-hello-ui"),
    join(root, "examples/plugin-hello-view"),
  ]);
  assert.equal(resolve(env.DESK_PLUGIN_DIRS), join(root, "plugins"));
});

test("just dev loads the dev plugin folder the caller names in DESK_DEV_PLUGINS", { skip }, () => {
  for (const folder of ["/some/folder", "/tmp/my plugins/a $HOME 'theme'"]) {
    const env = appEnv(dryRun({ DESK_DEV_PLUGINS: folder }));
    assert.equal(env.DESK_DEV_PLUGINS, folder);
    assert.equal(resolve(env.DESK_PLUGIN_DIRS), join(root, "plugins"));
  }
});

test("just dev builds the CEF desk first, and dev-shell is the same recipe", { skip }, () => {
  const all = dryRun({}, "dev", true);
  assert.match(all, /^cargo build -p desk-shell --bins$/mu, "build-shell runs before the desk");
  assert.doesNotMatch(all, /tauri/iu, "no Tauri left in the recipe (#97)");
  assert.equal(dryRun({}, "dev-shell"), dryRun({}, "dev"));
});
