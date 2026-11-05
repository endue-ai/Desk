// The `desk` CLI beside the app, for specs that read or write the desk from outside it: built once
// (`cargo build --release -p desk-cli`, or `DESK_CLI` names a binary) and run with the spec's HOME,
// so it finds the app's data folder and socket under it (support/driver.ts).
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME_VAR } from "./driver";

const root = fileURLToPath(new URL("../..", import.meta.url));
let built: string | undefined;

/** The CLI binary, built in release beside the app the first time a spec asks. */
export function deskCli(): string {
  if (built) return built;
  const given = process.env.DESK_CLI;
  if (given) {
    built = resolve(given);
    return built;
  }
  execFileSync("cargo", ["build", "--release", "-p", "desk-cli"], { cwd: root, stdio: "inherit" });
  built = join(root, "target/release/desk");
  if (!existsSync(built)) throw new Error(`no desk CLI at ${built}`);
  return built;
}

/** Run `desk <args>` as the spec's person: its HOME, no XDG_* or DESK_* of the runner's. */
export function desk(args: string[]): { status: number; stdout: string; stderr: string } {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (!/^(XDG_|DESK_)/.test(key)) env[key] = value;
  env.HOME = home;
  const run = spawnSync(deskCli(), args, { env, encoding: "utf8" });
  return { status: run.status ?? -1, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/** `desk <args>` that must succeed: its stdout. */
export function deskOk(args: string[]): string {
  const run = desk(args);
  if (run.status !== 0)
    throw new Error(`desk ${args.join(" ")} exited ${run.status}: ${run.stderr || run.stdout}`);
  return run.stdout;
}
