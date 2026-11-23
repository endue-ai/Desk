import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const workflow = (name) =>
  parse(readFileSync(new URL("../.github/workflows/" + name + ".yml", import.meta.url), "utf8"));

test("PR tools and security scans have only manual entry points", () => {
  for (const name of ["labeler", "scope-check", "review", "security", "codeql"]) {
    const config = workflow(name);
    assert.deepEqual(Object.keys(config.on), ["workflow_dispatch"], name);
    if (["labeler", "scope-check", "review"].includes(name)) {
      assert.equal(config.on.workflow_dispatch.inputs.pr.required, true, name);
    }
  }
});

const repository = "endue-ai/endue";
const pull = {
  number: 1,
  state: "open",
  draft: false,
  labels: [],
  additions: 5,
  deletions: 2,
  base: { sha: "a".repeat(40), ref: "main", repo: { full_name: repository } },
  head: { sha: "b".repeat(40), repo: { full_name: repository } },
};

test("manual PR metadata identifies one open PR and its immutable endpoints", async () => {
  const { selectPull, parseNumber } = await import("./manual-pr.mjs");
  for (const input of ["", "0", "-1", "1.5", "2/commits", "1\n", "1e2"]) {
    assert.throws(() => parseNumber(input), /positive PR number/);
  }
  assert.equal(parseNumber("1"), 1);
  const metadata = selectPull(pull, 1, repository);
  assert.equal(metadata.base, pull.base.sha);
  assert.equal(metadata.head, pull.head.sha);
  assert.equal(metadata.lines, 7);
  assert.equal(metadata.review, true);
  assert.throws(() => selectPull({ ...pull, state: "closed" }, 1, repository));
  assert.throws(() => selectPull(pull, 2, repository));
  assert.throws(() => selectPull(pull, 1, "endue-ai/endue-test"));
  assert.throws(() => selectPull({ ...pull, head: { ...pull.head, sha: "main" } }, 1, repository));
});

test("review excludes forks, dependency changes and drafts but their scope can still be checked", async () => {
  const { selectPull } = await import("./manual-pr.mjs");
  for (const change of [
    { draft: true },
    { labels: [{ name: "dependencies" }] },
    { head: { sha: pull.head.sha, repo: { full_name: "endue-test/endue" } } },
    { head: { sha: pull.head.sha, repo: null } },
  ]) {
    assert.equal(selectPull({ ...pull, ...change }, 1, repository).review, false);
  }
});
