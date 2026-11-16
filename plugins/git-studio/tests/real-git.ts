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

export const realGit = {
  run(args: string[], options: RunOptions = {}): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        ["-c", "core.quotepath=false", ...args],
        { cwd: options.cwd, env: ENV, maxBuffer: 8 << 20 },
        (error, stdout, stderr) => {
          const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
          const outcome = { code, signal: null, stdout, stderr };
          if (code === 0 || (options.ok ?? []).includes(code)) resolve(outcome);
          else
            reject(
              Object.assign(new Error(stderr.trim() || `git exited with ${code}`), { outcome }),
            );
        },
      );
      child.stdin?.end(options.input ?? "");
    });
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
