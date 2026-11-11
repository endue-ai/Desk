// Git reopens the repository it had after a relaunch (#160, finding 10): the surface's state lives
// only while the desk runs, so a start opens the repository the plugin's store remembers first.
// browser.reloadSession() quits the app and launches it again with the same HOME (support/driver.ts).
// The repository is a fixture made under the spec's HOME, with git's own configuration left out.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { deskCli, deskOk } from "../support/cli";
import { inFrame, shellReady, waitForData } from "../support/desk";
import { HOME_VAR } from "../support/driver";

const GIT = "endue.git";
const NAME = "fixture-repo";

/** A repository with one commit under the spec's HOME. */
function fixtureRepository(): string {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  const repo = join(home, "scratch", NAME);
  mkdirSync(repo, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { env });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "endue-team");
  git("config", "user.email", "team@endue.ai");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", "a.txt");
  git("commit", "-q", "-m", "Add a");
  return repo;
}

/** The Git window shows the repository NAME: its header names it and its status has a head. */
const showsRepository = () =>
  inFrame(GIT, async () => {
    await expect($("#repo")).toHaveText(NAME, { wait: 20_000 });
    await expect($("#view")).toHaveText(/Head:/);
  });

describe("git: the repository across a relaunch", () => {
  before(function () {
    // The CLI that opens the repository is built the first time a spec asks for it.
    this.timeout(900_000);
    deskCli();
  });

  it("Git opens a repository and remembers it", async () => {
    await shellReady();
    const repo = fixtureRepository();
    deskOk(["cmd", "run", "endue.git.status", "--args", JSON.stringify({ path: repo })]);
    await showsRepository();
    await waitForData(
      "store.json",
      (value) => JSON.stringify(value ?? "").includes(`scratch/${NAME}`),
      "the repository in Git's recent list",
    );
  });

  it("after a relaunch the Git window shows that repository again", async () => {
    await browser.reloadSession();
    await shellReady();
    await showsRepository();
  });
});
