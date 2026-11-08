#!/usr/bin/env node
// agent-hook: a Claude Code PreToolUse hook (.claude/settings.json) that stops an agent from starting
// Playwright directly on macOS (ADR 0018). The Playwright configs refuse such runs too; this also
// catches one-off configs and scripts that import Playwright, before anything starts.
//
// Reads the hook input (JSON) on stdin. Exit 2 with a reason on stderr blocks the command; anything
// it cannot parse passes, so the hook never gets in the way of unrelated work.

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REASON =
  "Playwright runs only through `just test-e2e` (and `just perf-opening`, for people) in this " +
  "repository. On macOS a direct run starts native WebKit, which crashed WindowServer and ended the " +
  "login session for every agent on this Mac (ADR 0018). Use `just test-e2e [playwright args]`: it " +
  "runs the tests in a Linux container, two runs per machine at most.";

/** Playwright subcommands that start no browser. */
const HARMLESS = new Set([
  undefined,
  "--version",
  "-V",
  "--help",
  "-h",
  "help",
  "install",
  "install-deps",
  "uninstall",
  "show-report",
  "show-trace",
  "merge-reports",
]);
const IMPORTS =
  /(?:from\s*|require\(\s*|import\(\s*)["'](?:playwright|playwright-core|@playwright\/test)(?:\/[^"']*)?["']/;
const PREFIXES = new Set(["env", "command", "exec", "nohup", "time", "nice"]);
const SCRIPT_FILE = /\.(?:[cm]?js|[cm]?ts)$/;

function stripHeredocs(command) {
  return command.replace(/<<-?\s*(["']?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, "");
}

function stripQuotes(command) {
  return command.replace(/'[^']*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

function importsPlaywright(file) {
  try {
    if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size > 512 * 1024)
      return false;
    return IMPORTS.test(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

/** The Playwright subcommand a segment's tokens run, or null when they do not run Playwright. */
function playwrightCall(tokens) {
  let i = 0;
  while (i < tokens.length && (/^\w+=/.test(tokens[i]) || PREFIXES.has(tokens[i]))) i++;
  if (tokens[i] === "timeout") i += 2;
  const cmd = tokens[i];
  if (!cmd) return null;
  const isPlaywright = (token) => /^(?:playwright|@playwright\/test)(?:@[\w.^~-]+)?$/.test(token);
  if (basename(cmd) === "playwright") return { sub: tokens[i + 1] };
  if (["npx", "pnpx", "bunx", "pnpm", "yarn", "npm"].includes(cmd)) {
    for (let j = i + 1; j < tokens.length; j++) {
      const token = tokens[j];
      if (
        ["--filter", "-F", "-C", "--dir", "--workspace", "-w", "-p", "--package"].includes(token)
      ) {
        j++;
      } else if (token.startsWith("-") || ["exec", "dlx", "x"].includes(token)) {
        // An option or the exec verb: the command comes later.
      } else {
        return isPlaywright(token) ? { sub: tokens[j + 1] } : null;
      }
    }
  }
  return null;
}

/** Why `command` must not run here, or null. */
export function blockReason(command, { platform = process.platform, cwd = process.cwd() } = {}) {
  if (platform !== "darwin" || typeof command !== "string") return null;
  const text = stripHeredocs(command);
  for (const [, , inner] of text.matchAll(
    /\b(?:bash|sh|zsh)\s+(?:-\w+\s+)*-c\s+(["'])([\s\S]*?)\1/g,
  )) {
    if (blockReason(inner, { platform, cwd })) return REASON;
  }
  for (const [, , code] of text.matchAll(
    /\bnode\b[^;&|\n]*?\s(?:-e|--eval|-p|--print)\s+(["'])([\s\S]*?)\1/g,
  )) {
    if (IMPORTS.test(code)) return REASON;
  }
  let dir = cwd;
  for (const segment of stripQuotes(text).split(/\|\||&&|[;|&\n()`]/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens[0] === "cd" && tokens[1]) {
      dir = resolve(dir, tokens[1]);
      continue;
    }
    const call = playwrightCall(tokens);
    if (call && !HARMLESS.has(call.sub)) return REASON;
    if (["node", "tsx", "bun"].includes(tokens[0])) {
      const file = tokens
        .slice(1)
        .find((token) => !token.startsWith("-") && SCRIPT_FILE.test(token));
      if (file && importsPlaywright(resolve(dir, file))) return REASON;
    }
  }
  return null;
}

/** Decide one hook call: { code: 0 } passes, { code: 2, message } blocks. */
export function hook(input, options = {}) {
  if (input?.tool_name !== "Bash") return { code: 0, message: "" };
  const reason = blockReason(input.tool_input?.command, {
    ...options,
    cwd: input.cwd ?? options.cwd,
  });
  return reason ? { code: 2, message: reason } : { code: 0, message: "" };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    process.exit(0);
  }
  const { code, message } = hook(input, { platform: process.platform, cwd: process.cwd() });
  if (message) process.stderr.write(`${message}\n`);
  process.exit(code);
}
