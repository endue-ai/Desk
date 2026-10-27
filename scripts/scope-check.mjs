#!/usr/bin/env node
// scope-check: a PR may only touch files inside its issue's Scope, and must carry an As-is → To-be
// table whose every row says how to verify it. Node 22, no dependencies.
//
// CI:    node scripts/scope-check.mjs                  (reads GITHUB_EVENT_PATH, GITHUB_TOKEN)
// Local: node scripts/scope-check.mjs --local <issue> --body <pr-body.md> [--base origin/main]

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LINK = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/i;
const TABLE_HEADING = /^#{2,3}\s+As-is\s*(?:→|->)\s*To-be\b/i;
const VERIFY_HEADER = /how to verify|verif|확인 방법/i;
const NO_RESPONSE = "_No response_";
const BOT_AUTHORS = new Set(["dependabot[bot]"]);

/** First issue number linked with "Closes #N" (or fixes/resolves), or null. */
export function parseLinkedIssue(body) {
  const match = LINK.exec(stripComments(body ?? ""));
  return match ? Number(match[1]) : null;
}

/** Parse the As-is → To-be table. Returns { found, header, rows, verifyIndex }. */
export function parseTable(body) {
  const lines = stripComments(body ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => TABLE_HEADING.test(line.trim()));
  if (start === -1) return { found: false, header: [], rows: [], verifyIndex: -1 };
  const tableLines = [];
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (trimmed.startsWith("|")) tableLines.push(trimmed);
  }
  const [headerLine, ...rest] = tableLines;
  if (!headerLine) return { found: true, header: [], rows: [], verifyIndex: -1 };
  const header = splitRow(headerLine);
  const found = header.findIndex((cell) => VERIFY_HEADER.test(cell));
  const verifyIndex = found === -1 ? header.length - 1 : found;
  const rows = rest
    .map(splitRow)
    .filter((cells) => !cells.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .filter((cells) => cells.some((cell) => cell !== ""));
  return { found: true, header, rows, verifyIndex };
}

/** Path globs from the issue's "### Scope" section. */
export function parseScope(issueBody) {
  const lines = (issueBody ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{2,4}\s+Scope\s*$/i.test(line.trim()));
  if (start === -1) return [];
  const globs = [];
  for (const line of stripComments(lines.slice(start + 1).join("\n")).split("\n")) {
    const trimmed = line.trim();
    if (/^#{1,6}\s/.test(trimmed)) break;
    if (trimmed === "" || trimmed.startsWith("```") || trimmed === NO_RESPONSE) continue;
    const glob = trimmed
      .replace(/^[-*+]\s+/, "")
      .replace(/^`(.*)`(?:\s.*)?$/, "$1")
      .trim();
    if (glob) globs.push(glob);
  }
  return globs;
}

/** Convert a path glob (**, *, ?, {a,b}) to an anchored RegExp. */
export function globToRegExp(glob) {
  let pattern = glob.trim().replace(/^\.?\//, "");
  if (pattern.endsWith("/")) pattern += "**";
  if (!/[*?{]/.test(pattern)) pattern += "{,/**}";
  return new RegExp(`^${translate(pattern)}$`);
}

function translate(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*" && pattern[i + 1] === "*") {
      const slash = pattern[i + 2] === "/";
      out += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else if (ch === "{") {
      const end = pattern.indexOf("}", i);
      if (end === -1) {
        out += "\\{";
        continue;
      }
      const options = pattern.slice(i + 1, end).split(",");
      out += `(?:${options.map(translate).join("|")})`;
      i = end;
    } else {
      out += ch.replace(/[.+^$()|[\]\\]/g, "\\$&");
    }
  }
  return out;
}

export function matchesAny(file, globs) {
  return globs.some((glob) => globToRegExp(glob).test(file));
}

/**
 * Decide the gate. Input: { prBody, author, issueNumber, issueBody, files }.
 * Output: { ok, notes: string[], problems: string[] }.
 */
export function evaluate({ prBody, author, issueNumber, issueBody, files }) {
  const notes = [];
  const problems = [];
  if (BOT_AUTHORS.has(author)) {
    notes.push(`Author ${author} is a dependency bot: scope and table checks do not apply.`);
    return { ok: true, notes, problems };
  }

  const table = parseTable(prBody);
  if (!table.found) {
    problems.push('No "## As-is → To-be" section in the PR body. Use the PR template.');
  } else if (table.rows.length === 0) {
    problems.push("The As-is → To-be table has no rows. Add one row per observable change.");
  } else {
    const column = table.header[table.verifyIndex] || "How to verify";
    table.rows.forEach((cells, index) => {
      if ((cells[table.verifyIndex] ?? "") === "") {
        problems.push(
          `Table row ${index + 1} (${cells[0] || "no area"}) has an empty "${column}" cell.`,
        );
      }
    });
    notes.push(`Table: ${table.rows.length} row(s).`);
  }

  if (issueNumber == null) {
    problems.push('No linked issue. Add "Closes #<issue>" to the PR body.');
    return { ok: false, notes, problems };
  }
  const globs = parseScope(issueBody);
  if (globs.length === 0) {
    problems.push(`Issue #${issueNumber} has no Scope. Run /plan-task ${issueNumber} first.`);
    return { ok: false, notes, problems };
  }
  notes.push(`Scope of #${issueNumber}: ${globs.join(", ")}`);
  const outside = files.filter((file) => !matchesAny(file, globs));
  for (const file of outside) problems.push(`Outside Scope: ${file}`);
  notes.push(`Changed files: ${files.length}, outside Scope: ${outside.length}.`);
  return { ok: problems.length === 0, notes, problems };
}

export function report({ ok, notes, problems }) {
  const lines = [ok ? "scope-check: PASS" : "scope-check: FAIL", ""];
  for (const note of notes) lines.push(`  ${note}`);
  if (problems.length > 0) {
    lines.push("", "Fix these:");
    for (const problem of problems) lines.push(`  - ${problem}`);
  }
  return lines.join("\n");
}

function stripComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, "");
}

function splitRow(line) {
  const inner = line.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim());
}

async function github(path, token) {
  const api = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${api}${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GET ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function fromGitHub() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("scope-check runs on pull_request events only");
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const issueNumber = parseLinkedIssue(pr.body);
  const issueBody =
    issueNumber == null ? "" : (await github(`/repos/${repo}/issues/${issueNumber}`, token)).body;
  const files = [];
  for (let page = 1; ; page++) {
    const batch = await github(
      `/repos/${repo}/pulls/${pr.number}/files?per_page=100&page=${page}`,
      token,
    );
    for (const file of batch) {
      files.push(file.filename);
      if (file.previous_filename) files.push(file.previous_filename);
    }
    if (batch.length < 100) break;
  }
  return { prBody: pr.body ?? "", author: pr.user?.login ?? "", issueNumber, issueBody, files };
}

function fromLocal(args) {
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const issueNumber = Number(value("--local"));
  const bodyFile = value("--body");
  if (!issueNumber || !bodyFile)
    throw new Error("usage: --local <issue> --body <file> [--base ref]");
  const base = value("--base") ?? "origin/main";
  const git = (...rest) => execFileSync("git", rest, { encoding: "utf8" });
  const files = git("diff", "--name-only", "--find-renames", `${base}...HEAD`)
    .split("\n")
    .filter(Boolean);
  const issueBody = JSON.parse(
    execFileSync("gh", ["issue", "view", String(issueNumber), "--json", "body"], {
      encoding: "utf8",
    }),
  ).body;
  return { prBody: readFileSync(bodyFile, "utf8"), author: "", issueNumber, issueBody, files };
}

async function main() {
  const args = process.argv.slice(2);
  const input = args.includes("--local") ? fromLocal(args) : await fromGitHub();
  const result = evaluate(input);
  const text = report(result);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\`\`\`text\n${text}\n\`\`\`\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`scope-check: error: ${error.message}`);
    process.exitCode = 2;
  });
}
