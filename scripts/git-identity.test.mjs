import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// scripts/git-identity/check.sh on throwaway repositories. The personal strings are made up; the real
// ones live only in a machine's config (install.sh).
const check = fileURLToPath(new URL("./git-identity/check.sh", import.meta.url));
const dirs = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const TEAM = { GIT_AUTHOR_NAME: "endue-team", GIT_AUTHOR_EMAIL: "team@endue.ai" };
const committer = (env) => ({
  ...env,
  GIT_COMMITTER_NAME: env.GIT_AUTHOR_NAME,
  GIT_COMMITTER_EMAIL: env.GIT_AUTHOR_EMAIL,
});

/** A repository with `url` as origin, the made-up personal strings, and git kept off the user's config. */
function repo(url) {
  const dir = mkdtempSync(join(tmpdir(), "git-identity-"));
  dirs.push(dir);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, extra = {}, input) =>
    execFileSync("git", args, { cwd: dir, env: { ...env, ...extra }, input, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  if (url) git(["remote", "add", "origin", url]);
  git(["config", "endue.block", "someone@personal.example"]);
  git(["config", "--add", "endue.block", "personal-handle"]);
  git(["config", "--add", "endue.block", "Firstname"]);
  const commit = (who, message = "feat: a change") =>
    git(["commit", "-q", "--allow-empty", "-m", message], committer(who));
  const run = (args, who = TEAM, input = "") =>
    spawnSync("bash", [check, ...args], { cwd: dir, env: { ...env, ...committer(who) }, input });
  return { dir, git, commit, run };
}

const GITHUB = "https://github.com/endue-ai/Desk.git";
const GITLAB = "https://git.example.test/endue/web.git";
const OTHER = { GIT_AUTHOR_NAME: "A Colleague", GIT_AUTHOR_EMAIL: "colleague@company.example" };
const PERSONAL = { GIT_AUTHOR_NAME: "Someone", GIT_AUTHOR_EMAIL: "someone@personal.example" };
const GUESSED = { GIT_AUTHOR_NAME: "someone", GIT_AUTHOR_EMAIL: "someone@laptop.local" };

test("GitHub endue-ai takes only the team and Claude as author and committer", () => {
  const r = repo(GITHUB);
  assert.equal(r.run(["pre-commit"]).status, 0);
  const claude = { GIT_AUTHOR_NAME: "Claude", GIT_AUTHOR_EMAIL: "noreply@anthropic.com" };
  assert.equal(r.run(["pre-commit"], claude).status, 0);
  const refused = r.run(["pre-commit"], OTHER);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr.toString(), /not team@endue\.ai or Claude/);
  assert.equal(r.run(["pre-commit"], PERSONAL).status, 1);
  assert.equal(r.run(["pre-commit"], { ...TEAM, GIT_AUTHOR_NAME: "Firstname" }).status, 1);
});

test("GitHub endue-ai refuses any other email in a message, but not Claude's or the diff of -v", () => {
  const r = repo(GITHUB);
  const message = (text) => {
    const file = join(r.dir, "MSG");
    writeFileSync(file, text);
    return r.run(["commit-msg", file]).status;
  };
  const ok = "feat: x\n\nSigned-off-by: endue-team <team@endue.ai>\n";
  assert.equal(message(`${ok}Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n`), 0);
  assert.equal(message(`${ok}Co-authored-by: A Colleague <colleague@company.example>\n`), 1);
  assert.equal(message("fix: thanks to Firstname\n"), 1);
  const scissors = "# ------------------------ >8 ------------------------\n";
  assert.equal(message(`${ok}${scissors}+ mail me at colleague@company.example\n`), 0);
});

test("GitLab refuses only an identity git guessed from the host name", () => {
  const r = repo(GITLAB);
  assert.equal(r.run(["pre-commit"], OTHER).status, 0);
  assert.equal(r.run(["pre-commit"], PERSONAL).status, 0);
  assert.equal(r.run(["pre-commit"], GUESSED).status, 1);
  const file = join(r.dir, "MSG");
  writeFileSync(file, "feat: x\n\nCo-authored-by: Someone <someone@personal.example>\n");
  assert.equal(r.run(["commit-msg", file]).status, 0);
});

test("a push to GitHub endue-ai checks the whole branch, even commits this clone tracks", () => {
  const r = repo(GITHUB);
  r.commit(OTHER, "feat: old history");
  r.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  r.commit(TEAM);
  const head = r.git(["rev-parse", "HEAD"]).trim();
  const zero = "0".repeat(40);
  const push = r.run(
    ["pre-push", "origin", GITHUB],
    TEAM,
    `refs/heads/main ${head} refs/heads/main ${zero}\n`,
  );
  assert.equal(push.status, 1);
  assert.match(push.stderr.toString(), /old history|colleague@company\.example/);
});

test("a push to GitLab skips what the remote holds and refuses only a new guessed identity", () => {
  const r = repo(GITLAB);
  r.commit(GUESSED, "feat: already on the server");
  r.git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  r.commit(PERSONAL);
  const line = (sha) => `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n`;
  const head = () => r.git(["rev-parse", "HEAD"]).trim();
  assert.equal(r.run(["pre-push", "origin", GITLAB], TEAM, line(head())).status, 0);
  r.commit(GUESSED);
  assert.equal(r.run(["pre-push", "origin", GITLAB], TEAM, line(head())).status, 1);
});

test("a deleted ref pushes nothing to check", () => {
  const r = repo(GITHUB);
  const zero = "0".repeat(40);
  const input = `(delete) ${zero} refs/heads/old ${"a".repeat(40)}\n`;
  assert.equal(r.run(["pre-push", "origin", GITHUB], TEAM, input).status, 0);
});

const ensure = fileURLToPath(new URL("./git-identity/ensure.sh", import.meta.url));

/** A machine of its own: a HOME, a global config with a personal identity, and a Desk checkout. */
function machine() {
  const home = mkdtempSync(join(tmpdir(), "git-identity-home-"));
  dirs.push(home);
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
  env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
  writeFileSync(
    env.GIT_CONFIG_GLOBAL,
    "[user]\n\tname = Someone\n\temail = someone@personal.example\n",
  );
  const dir = join(home, "work", "Desk");
  execFileSync("git", ["init", "-q", "-b", "main", dir], { env });
  execFileSync("git", ["remote", "add", "origin", GITHUB], { cwd: dir, env });
  const git = (args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const run = (team) =>
    spawnSync("bash", [ensure], {
      cwd: dir,
      env: { ...env, ENDUE_IDENTITY_TEAM: team },
      encoding: "utf8",
    });
  return { home, git, run };
}

test("ensure installs on a team machine for this repository, then stays quiet", () => {
  const m = machine();
  assert.match(m.run("1").stdout, /installed for .*Desk: commits as endue-team/);
  assert.equal(m.git(["config", "user.email"]), "team@endue.ai");
  assert.equal(m.git(["config", "core.hooksPath"]), join(m.home, ".config/git/endue-hooks"));
  assert.equal(m.run("1").stdout, "");
});

test("ensure puts a newer check in place of an older one, never the other way", () => {
  const m = machine();
  m.run("1");
  const installed = join(m.home, ".config/git/endue-hooks/check.sh");
  writeFileSync(installed, "IDENTITY_VERSION=1\n");
  assert.match(m.run("1").stdout, /now run version \d+/);
  writeFileSync(installed, "IDENTITY_VERSION=999\n");
  assert.equal(m.run("1").stdout, "");
});

test("ensure on a machine outside the team only says how and changes nothing", () => {
  const m = machine();
  assert.match(m.run("0").stdout, /just identity/);
  assert.equal(m.git(["config", "user.email"]), "someone@personal.example");
  assert.throws(() => m.git(["config", "core.hooksPath"]));
});
