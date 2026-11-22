// A runner with the plugin runner's contract over the real git program, and a throwaway repository,
// so the operations are tested against what git does rather than a script of it.
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type Outcome = {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
};
export type RunOptions = { cwd?: string; input?: string; ok?: number[]; timeoutMs?: number };

const ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

/** Both test adapters keep Git's raw output until their own text or bridge encoding step. */
export function gitOutput(
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; input?: string },
): Promise<{ code: number; stdout: Buffer; stderr: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      args,
      { cwd: options.cwd, env: options.env, encoding: "buffer", maxBuffer: 8 << 20 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, stdout, stderr });
      },
    );
    // Commands such as git version and failed invocations may finish without consuming input.
    child.stdin?.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") reject(error);
    });
    child.stdin?.end(options.input);
  });
}

export const realGit = {
  async run(args: string[], options: RunOptions = {}): Promise<Outcome> {
    const { code, stdout, stderr } = await gitOutput(["-c", "core.quotepath=false", ...args], {
      cwd: options.cwd,
      env: ENV,
      input: options.input,
    });
    const outcome = { code, signal: null, stdout: stdout.toString(), stderr: stderr.toString() };
    if (code === 0 || (options.ok ?? []).includes(code)) return outcome;
    throw Object.assign(new Error(outcome.stderr.trim() || `git exited with ${code}`), { outcome });
  },
};

/** A new repository with one commit of `a.txt`; `done()` removes it. */
export async function tempRepo() {
  const root = mkdtempSync(join(tmpdir(), "gs-test-"));
  const git = (...args: string[]) => realGit.run(args, { cwd: root });
  await git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.txt"), "one\n");
  await git("add", "a.txt");
  await git("commit", "-q", "-m", "First");
  return {
    root,
    git,
    write: (path: string, text: string) => writeFileSync(join(root, path), text),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}
