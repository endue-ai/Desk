import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { PaletteResult, PluginManifest } from "../../../packages/bridge/src/index";
import { mount, type Reply, ROOT, repository } from "./harness";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** Ajv over specs/plugin/v0 and the specs it references, for PaletteResults. */
function paletteResults() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const validate = ajv.getSchema(
    "https://endue.ai/specs/plugin/v0/contributes.schema.json#/$defs/PaletteResults",
  );
  if (!validate) throw new Error("cannot compile PaletteResults");
  return validate;
}

const REFS = [
  "main\x1f1111111\x1forigin/main",
  "feature/x\x1f2222222\x1f",
  "origin/HEAD\x1f1111111\x1f",
  "origin/main\x1f1111111\x1f",
  "origin/topic\x1f3333333\x1f",
  "",
].join("\n");

const REFUSED = [
  "error: Your local changes to the following files would be overwritten by checkout:",
  "\tunstaged.js",
  "Please commit your changes or stash them before you switch branches.",
  "Aborting",
  "",
].join("\n");

/** The Git plugin with ROOT open: its status on main, these branches, and more replies. */
const opened = async (table: Record<string, Reply> = {}) => {
  const mounted = await mount({
    script: repository({ "for-each-ref": { stdout: REFS }, ...table }),
  });
  await mounted.host.command("endue.git.status", { path: ROOT });
  return mounted;
};

type Answer = { results: PaletteResult[] };

describe("the palette's Branches provider", () => {
  it("contributes the Branches provider for endue.git.branches", () => {
    const manifest = readJson(join(root, "plugins/git/plugin.json")) as PluginManifest;
    expect(manifest.contributes?.paletteProviders).toEqual([
      { command: "endue.git.branches", title: "Branches" },
    ]);
    expect(manifest.contributes?.commands?.map((c) => c.id)).toContain("endue.git.branches");
  });

  it("answers the open repository's local and remote branches that hold the typed words", async () => {
    const { host } = await opened();
    const valid = paletteResults();
    const main = (await host.command("endue.git.branches", { query: "main", limit: 5 })) as Answer;
    expect(valid(main), JSON.stringify(valid.errors)).toBe(true);
    expect(main.results).toEqual([
      {
        id: "main",
        title: "main",
        detail: "Desk · 1111111 → origin/main · current",
        kind: "branch",
        actions: [
          { command: "endue.git.checkout", title: "Switch to the branch", args: { ref: "main" } },
        ],
      },
      {
        id: "origin/main",
        title: "origin/main",
        detail: "Desk · 1111111",
        kind: "branch",
        actions: [
          {
            command: "endue.git.checkout",
            title: "Track the branch and switch",
            args: { ref: "origin/main" },
          },
        ],
      },
    ]);

    const topic = (await host.command("endue.git.branches", { query: "TOP", limit: 5 })) as Answer;
    expect(topic.results.map((r) => r.id)).toEqual(["origin/topic"]);
    const words = (await host.command("endue.git.branches", {
      query: "desk feat",
      limit: 5,
    })) as Answer;
    expect(words.results.map((r) => r.id)).toEqual(["feature/x"]);
    // The word "branch" names them all; origin/HEAD is not a branch to switch to.
    const all = (await host.command("endue.git.branches", { query: "branch", limit: 3 })) as Answer;
    expect(valid(all), JSON.stringify(valid.errors)).toBe(true);
    expect(all.results.map((r) => r.id)).toEqual(["main", "feature/x", "origin/main"]);
    const more = (await host.command("endue.git.branches", { query: "branch" })) as Answer;
    expect(more.results.map((r) => r.id)).toEqual([
      "main",
      "feature/x",
      "origin/main",
      "origin/topic",
    ]);
  });

  it("answers nothing without an open repository or a match", async () => {
    const closed = await mount({ script: repository({ "for-each-ref": { stdout: REFS } }) });
    expect(await closed.host.command("endue.git.branches", { query: "main", limit: 5 })).toEqual({
      results: [],
    });
    expect(closed.git.of("for-each-ref")).toEqual([]);

    const { host, git, view } = await opened();
    const said = view.said.length;
    expect(await host.command("endue.git.branches", { query: "nothing", limit: 5 })).toEqual({
      results: [],
    });
    expect(await host.command("endue.git.branches", { query: "  ", limit: 5 })).toEqual({
      results: [],
    });
    expect(git.of("switch")).toEqual([]);
    // Asking is not an operation: Git's status line keeps what it said.
    expect(view.said).toHaveLength(said);
  });

  it("a pick runs endue.git.checkout", async () => {
    const { host, git, view, ran } = await opened();
    const run = async (query: string) => {
      const answer = (await host.command("endue.git.branches", { query, limit: 5 })) as Answer;
      const action = answer.results[0]?.actions[0];
      if (!action) throw new Error(`no result for ${query}`);
      return host.command(action.command, action.args);
    };
    await run("feature");
    expect(git.of("switch").at(-1)).toEqual(["switch", "-q", "feature/x"]);
    expect(view.said.at(-1)).toBe("Switched to feature/x.");
    await run("topic");
    expect(git.of("switch").at(-1)).toEqual(["switch", "-q", "--track", "origin/topic"]);
    expect(view.said.at(-1)).toBe("Switched to origin/topic.");
    // The branch was named: nothing is asked.
    expect(ran("desk.palette.pick")).toEqual([]);
  });

  it("a pick on a dirty tree that git refuses fails in git's words and runs nothing destructive", async () => {
    const { host, git, view } = await opened({ switch: { code: 1, stderr: REFUSED } });
    const answer = (await host.command("endue.git.branches", {
      query: "feature",
      limit: 5,
    })) as Answer;
    const action = answer.results[0]?.actions[0];
    expect(action).toEqual({
      command: "endue.git.checkout",
      title: "Switch to the branch",
      args: { ref: "feature/x" },
    });
    if (!action) return;
    const before = git.calls.length;
    await expect(host.command(action.command, action.args)).rejects.toThrow(
      /would be overwritten by checkout/,
    );
    expect(view.said.at(-1)).toMatch(/would be overwritten by checkout/);
    // The pick lists the branches and switches, as Git: switch branch does; git refused, so nothing
    // more runs.
    const picked = git.calls.slice(before);
    expect(picked.map((c) => c.args[0])).toEqual(["remote", "for-each-ref", "switch"]);
    expect(git.of("switch")).toEqual([["switch", "-q", "feature/x"]]);
    const destructive = picked.filter(
      ({ args: [sub, ...rest] }) =>
        ["stash", "reset", "restore", "clean", "checkout"].includes(sub ?? "") ||
        rest.some((arg) => ["--force", "-f", "--discard-changes", "--merge", "-m"].includes(arg)),
    );
    expect(destructive).toEqual([]);
  });
});
