import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// Git identity hooks on throwaway repositories. Every test identity below is a fixed project fixture.
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
  git(["config", "endue.block", "fixture@endue.invalid"]);
  git(["config", "--add", "endue.block", "endue-fixture-handle"]);
  git(["config", "--add", "endue.block", "endue-fixture-blocked"]);
  const commit = (who, message = "feat: a change") =>
    git(["commit", "-q", "--allow-empty", "-m", message], committer(who));
  const run = (args, who = TEAM, input = "", extra = {}) =>
    spawnSync("bash", [check, ...args], {
      cwd: dir,
      env: { ...env, ...committer(who), ...extra },
      input,
    });
  return { dir, git, commit, run };
}

const GITHUB = "https://github.com/endue-ai/endue.git";
const GITLAB = "https://git.example.test/endue/web.git";
const OTHER = { GIT_AUTHOR_NAME: "endue-fixture-other", GIT_AUTHOR_EMAIL: "other@endue.invalid" };
const PERSONAL = { GIT_AUTHOR_NAME: "endue-fixture", GIT_AUTHOR_EMAIL: "fixture@endue.invalid" };
const GUESSED = {
  GIT_AUTHOR_NAME: "endue-fixture",
  GIT_AUTHOR_EMAIL: "fixture@endue-fixture.local",
};

test("a per-process rule refuses a message without echoing or storing the rule", () => {
  const r = repo(GITHUB);
  const word = "endue-fixture-transient";
  const file = join(r.dir, "MSG");
  writeFileSync(file, `fix: ${word}\n`);
  const refused = r.run(["commit-msg", file], TEAM, "", { ENDUE_IDENTITY_BLOCK: word });
  assert.equal(refused.status, 1);
  assert.ok(!refused.stderr.toString().includes(word));
  assert.ok(!r.git(["config", "--local", "--list"]).includes(word));
  assert.equal(r.run(["commit-msg", file]).status, 0);
});

test("GitHub endue-ai takes only the team and Claude as author and committer", () => {
  const r = repo(GITHUB);
  assert.equal(r.run(["pre-commit"]).status, 0);
  const claude = { GIT_AUTHOR_NAME: "Claude", GIT_AUTHOR_EMAIL: "noreply@anthropic.com" };
  assert.equal(r.run(["pre-commit"], claude).status, 0);
  const refused = r.run(["pre-commit"], OTHER);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr.toString(), /not team@endue\.ai or Claude/);
  assert.ok(!refused.stderr.toString().includes(OTHER.GIT_AUTHOR_EMAIL));
  assert.ok(!refused.stderr.toString().includes(OTHER.GIT_AUTHOR_NAME));
  const wrongName = r.run(["pre-commit"], { ...TEAM, GIT_AUTHOR_NAME: "endue-fixture-other" });
  assert.equal(wrongName.status, 1);
  assert.ok(!wrongName.stderr.toString().includes("endue-fixture-other"));
  assert.equal(r.run(["pre-commit"], PERSONAL).status, 1);
  assert.equal(
    r.run(["pre-commit"], { ...TEAM, GIT_AUTHOR_NAME: "endue-fixture-blocked" }).status,
    1,
  );
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
  assert.equal(message(`${ok}Co-authored-by: endue-fixture-other <other@endue.invalid>\n`), 1);
  assert.equal(message("fix: thanks to endue-fixture-blocked\n"), 1);
  const scissors = "# ------------------------ >8 ------------------------\n";
  assert.equal(message(`${ok}${scissors}+ mail me at other@endue.invalid\n`), 0);
});

test("GitLab refuses only an identity git guessed from the host name", () => {
  const r = repo(GITLAB);
  assert.equal(r.run(["pre-commit"], OTHER).status, 0);
  assert.equal(r.run(["pre-commit"], PERSONAL).status, 0);
  assert.equal(r.run(["pre-commit"], GUESSED).status, 1);
  const file = join(r.dir, "MSG");
  writeFileSync(file, "feat: x\n\nCo-authored-by: endue-fixture <fixture@endue.invalid>\n");
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
  assert.match(push.stderr.toString(), /refused/);
  assert.ok(!push.stderr.toString().includes(OTHER.GIT_AUTHOR_EMAIL));
});

test("a push to GitHub endue-ai takes GitHub as the committer of a squash merge", () => {
  const r = repo(GITHUB);
  const zero = "0".repeat(40);
  const push = () => {
    const head = r.git(["rev-parse", "HEAD"]).trim();
    return r.run(
      ["pre-push", "origin", GITHUB],
      TEAM,
      `refs/heads/a ${head} refs/heads/a ${zero}\n`,
    );
  };
  const squash = (committerName, committerEmail, author = TEAM) =>
    r.git(["commit", "-q", "--allow-empty", "-m", "feat: merged (#1)"], {
      ...author,
      GIT_COMMITTER_NAME: committerName,
      GIT_COMMITTER_EMAIL: committerEmail,
    });
  squash("GitHub", "noreply@github.com");
  r.commit(TEAM);
  assert.equal(push().status, 0);
  squash("endue-fixture", "123+endue-fixture@users.noreply.github.com");
  assert.equal(push().status, 1);
});

test("GitHub is never the author of a pushed commit, nor the committer of a local one", () => {
  const r = repo(GITHUB);
  const github = { GIT_AUTHOR_NAME: "GitHub", GIT_AUTHOR_EMAIL: "noreply@github.com" };
  assert.equal(r.run(["pre-commit"], github).status, 1);
  r.commit(github);
  const head = r.git(["rev-parse", "HEAD"]).trim();
  const input = `refs/heads/a ${head} refs/heads/a ${"0".repeat(40)}\n`;
  assert.equal(r.run(["pre-push", "origin", GITHUB], TEAM, input).status, 1);
  const file = join(r.dir, "MSG");
  writeFileSync(file, "feat: x\n\nCo-authored-by: GitHub <noreply@github.com>\n");
  assert.equal(r.run(["commit-msg", file]).status, 1);
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

/** A machine of its own: a HOME, a global config with a personal identity, and an endue checkout. */
function machine() {
  const home = mkdtempSync(join(tmpdir(), "git-identity-home-"));
  dirs.push(home);
  const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" };
  env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
  writeFileSync(
    env.GIT_CONFIG_GLOBAL,
    "[user]\n\tname = endue-fixture\n\temail = fixture@endue.invalid\n",
  );
  const dir = join(home, "work", "endue");
  execFileSync("git", ["init", "-q", "-b", "main", dir], { env });
  execFileSync("git", ["remote", "add", "origin", GITHUB], { cwd: dir, env });
  const git = (args) => execFileSync("git", args, { cwd: dir, env, encoding: "utf8" }).trim();
  const run = (team, extra = {}) =>
    spawnSync("bash", [ensure], {
      cwd: dir,
      env: { ...env, ENDUE_IDENTITY_TEAM: team, ...extra },
      encoding: "utf8",
    });
  return { home, git, run };
}

test("ensure installs on a team machine for this repository, then stays quiet", () => {
  const m = machine();
  const setup = m.run("1").stdout;
  assert.match(setup, /installed for this repository/);
  assert.ok(!setup.includes(m.home));
  assert.equal(m.git(["config", "user.email"]), "team@endue.ai");
  assert.equal(
    m.git(["config", "--path", "core.hooksPath"]),
    join(m.home, ".config/git/endue-hooks"),
  );
  assert.ok(!m.git(["config", "--global", "--list"]).includes(m.home));
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
  assert.equal(m.git(["config", "user.email"]), "fixture@endue.invalid");
  assert.throws(() => m.git(["config", "core.hooksPath"]));
});

test("both repository names select the strict team hooks", () => {
  for (const url of [GITHUB, "https://github.com/endue-ai/Desk.git"]) {
    const r = repo(url);
    assert.equal(r.run(["pre-commit"], TEAM).status, 0);
    assert.equal(r.run(["pre-commit"], OTHER).status, 1);
  }
});

test("ensure checks push access to the canonical repository", () => {
  const m = machine();
  writeFileSync(
    join(m.home, "gh"),
    '#!/bin/sh\n[ "$*" = "api repos/endue-ai/endue --jq .permissions.push" ] && echo true\n',
    { mode: 0o755 },
  );
  assert.match(m.run("", { PATH: `${m.home}:${process.env.PATH}` }).stdout, /installed for/);
});
