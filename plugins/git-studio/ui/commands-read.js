// Bounded data from the same Git readers used by the window.
import { commitAt, pathInRepo } from "./command-input.js";
import { blame, fileHistory } from "./history.js";
import { loadCommit, loadDiff } from "./repo.js";

const MAX_TEXT = 32_768;
const MAX_FILES = 100;
const MAX_LINES = 200;
const MAX_HISTORY = 50;

/** @param {import("./command-input.js").Register} on @param {import("./app.js").App} app @param {() => string} need */
export function registerReads(on, app, need) {
  const git = app.git;
  on("diff", async ({ path, staged = false, sha }) => {
    const root = need();
    const file = path === undefined ? undefined : pathInRepo(path);
    const paths = file === undefined ? {} : { path: file };
    if (sha !== undefined && staged) throw new Error("Choose a commit or the index.");
    let text;
    if (sha !== undefined) {
      const commit = await loadCommit(git, root, await commitAt(git, root, sha));
      text = await loadDiff(git, root, {
        ...paths,
        kind: "commit",
        sha: commit.sha,
        parent: commit.parents[0] ?? null,
        origPath: commit.files.find((f) => f.path === file)?.origPath,
      });
    } else {
      const change =
        file && staged ? app.get().snapshot?.status.staged.find((f) => f.path === file) : undefined;
      const untracked =
        !!file &&
        !staged &&
        (
          await git.run(
            ["--literal-pathspecs", "ls-files", "--others", "--exclude-standard", "-z", "--", file],
            { cwd: root },
          )
        ).stdout
          .split("\0")
          .includes(file);
      text = await loadDiff(git, root, {
        ...paths,
        kind: staged ? "staged" : "unstaged",
        untracked,
        origPath: change?.origPath,
      });
    }
    return { text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT };
  });
  on("show", async ({ sha }) => {
    const root = need();
    const detail = await loadCommit(git, root, await commitAt(git, root, sha));
    const { email: _email, committerEmail: _committerEmail, files, body, ...rest } = detail;
    return {
      ...rest,
      files: files.slice(0, MAX_FILES),
      body: body.slice(0, MAX_TEXT),
      truncated: files.length > MAX_FILES || body.length > MAX_TEXT,
    };
  });
  on("blame-data", async ({ path }) => {
    const root = need();
    const data = await blame(git, root, pathInRepo(path));
    let remaining = MAX_TEXT;
    const lines = data.lines.slice(0, MAX_LINES).map((line) => {
      const text = line.text.slice(0, remaining);
      remaining -= text.length;
      return { ...line, text };
    });
    return {
      lines,
      commits: [...new Set(lines.map((line) => line.sha))].flatMap((sha) => {
        const commit = data.commits.get(sha);
        if (!commit) return [];
        const { email: _email, ...rest } = commit;
        return [rest];
      }),
      truncated: data.lines.length > lines.length || remaining === 0,
    };
  });
  on("file-log", async ({ path }) => {
    const commits = await fileHistory(git, need(), pathInRepo(path), MAX_HISTORY + 1);
    return { commits: commits.slice(0, MAX_HISTORY), more: commits.length > MAX_HISTORY };
  });
}
