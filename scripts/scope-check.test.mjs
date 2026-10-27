import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluate,
  globToRegExp,
  matchesAny,
  parseLinkedIssue,
  parseScope,
  parseTable,
  report,
} from "./scope-check.mjs";

const TABLE = `
## Requirement
> do the thing

## As-is → To-be

| Area | As-is | To-be | How to verify |
| --- | --- | --- | --- |
| Runtime | no layout | layout restore | \`layout.test.ts\` |
| Spec | none | bridge v0 | \`specs/bridge/v0/vectors\` |

## Assumptions and decisions
`;

const ISSUE = `### Requirement

Build it.

### Scope

- \`packages/runtime/**\`
- \`specs/bridge/v0/\`
- \`docs/adr/*.md\` (new ADR only)

### Acceptance tests

_No response_
`;

describe("parseLinkedIssue", () => {
  it("finds Closes, Fixes and Resolves", () => {
    assert.equal(parseLinkedIssue("Closes #12"), 12);
    assert.equal(parseLinkedIssue("this fixes #7 nicely"), 7);
    assert.equal(parseLinkedIssue("Resolved #3"), 3);
  });
  it("ignores mentions without a keyword and HTML comments", () => {
    assert.equal(parseLinkedIssue("see #4"), null);
    assert.equal(parseLinkedIssue("<!-- Closes #9 -->"), null);
  });
});

describe("parseTable", () => {
  it("reads rows and the verify column", () => {
    const table = parseTable(TABLE);
    assert.equal(table.found, true);
    assert.equal(table.rows.length, 2);
    assert.equal(table.header[table.verifyIndex], "How to verify");
    assert.equal(table.rows[1][3], "`specs/bridge/v0/vectors`");
  });
  it("accepts -> and the Korean verify header", () => {
    const body =
      "## As-is -> To-be\n| 영역 | As-is | To-be | 확인 방법 |\n| --- | --- | --- | --- |\n| a | b | c | d |";
    const table = parseTable(body);
    assert.equal(table.rows.length, 1);
    assert.equal(table.verifyIndex, 3);
  });
  it("skips the empty template row and stops at the next heading", () => {
    const body =
      "## As-is → To-be\n| A | B | C | How to verify |\n| --- | --- | --- | --- |\n| | | | |\n## Next\n| x | y | z | w |";
    assert.deepEqual(parseTable(body).rows, []);
  });
  it("reports a missing section", () => {
    assert.equal(parseTable("no table here").found, false);
  });
});

describe("parseScope", () => {
  it("reads bullet globs and strips backticks and trailing notes", () => {
    assert.deepEqual(parseScope(ISSUE), [
      "packages/runtime/**",
      "specs/bridge/v0/",
      "docs/adr/*.md",
    ]);
  });
  it("returns nothing for an unfilled form", () => {
    assert.deepEqual(parseScope("### Scope\n\n_No response_\n\n### Acceptance tests\n"), []);
  });
  it("reads globs inside a code fence", () => {
    assert.deepEqual(parseScope("### Scope\n\n```text\ncrates/desk-core/**\n```\n"), [
      "crates/desk-core/**",
    ]);
  });
});

describe("globToRegExp", () => {
  const cases = [
    ["crates/**", "crates/desk-core/src/lib.rs", true],
    ["crates/**", "crate/x", false],
    ["**/*.md", "README.md", true],
    ["**/*.md", "docs/adr/0001.md", true],
    ["packages/*/src/*.ts", "packages/ui/src/index.ts", true],
    ["packages/*/src/*.ts", "packages/ui/src/deep/index.ts", false],
    ["specs/bridge/v0/", "specs/bridge/v0/fs.json", true],
    ["justfile", "justfile", true],
    ["specs/brain", "specs/brain/v0/openapi.yaml", true],
    ["specs/brain", "specs/brainstorm.md", false],
    ["{Cargo.lock,pnpm-lock.yaml}", "pnpm-lock.yaml", true],
    ["src/file?.rs", "src/file1.rs", true],
    ["a.b", "axb", false],
  ];
  for (const [glob, file, expected] of cases) {
    it(`${glob} ${expected ? "matches" : "does not match"} ${file}`, () => {
      assert.equal(globToRegExp(glob).test(file), expected);
    });
  }
  it("matchesAny is true when one glob matches", () => {
    assert.equal(matchesAny("docs/x.md", ["crates/**", "docs/**"]), true);
  });
});

describe("evaluate", () => {
  const base = {
    prBody: `Closes #5\n${TABLE}`,
    author: "someone",
    issueNumber: 5,
    issueBody: ISSUE,
  };

  it("passes when every file is in Scope and the table is complete", () => {
    const result = evaluate({
      ...base,
      files: ["packages/runtime/src/layout.ts", "specs/bridge/v0/fs.json"],
    });
    assert.equal(result.ok, true, report(result));
  });
  it("fails on a file outside Scope", () => {
    const result = evaluate({ ...base, files: ["packages/runtime/src/a.ts", "README.md"] });
    assert.equal(result.ok, false);
    assert.deepEqual(result.problems, ["Outside Scope: README.md"]);
  });
  it("fails without a table", () => {
    const result = evaluate({ ...base, prBody: "Closes #5", files: [] });
    assert.match(result.problems.join("\n"), /No "## As-is → To-be" section/);
  });
  it("fails on an empty verify cell", () => {
    const prBody =
      "Closes #5\n## As-is → To-be\n| Area | As-is | To-be | How to verify |\n| --- | --- | --- | --- |\n| UI | a | b |  |";
    const result = evaluate({ ...base, prBody, files: [] });
    assert.match(result.problems.join("\n"), /row 1 \(UI\) has an empty "How to verify" cell/);
  });
  it("fails without a linked issue or without a Scope", () => {
    assert.match(
      evaluate({ ...base, issueNumber: null, files: [] }).problems.join("\n"),
      /No linked issue/,
    );
    assert.match(
      evaluate({ ...base, issueBody: "### Scope\n\n_No response_", files: [] }).problems.join("\n"),
      /no Scope/,
    );
  });
  it("lets dependency bots through", () => {
    const result = evaluate({
      prBody: "",
      author: "dependabot[bot]",
      issueNumber: null,
      issueBody: "",
      files: ["Cargo.lock"],
    });
    assert.equal(result.ok, true);
  });
});
