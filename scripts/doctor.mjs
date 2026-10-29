#!/usr/bin/env node
// doctor: is this machine's session still able to run agents? (ADR 0018)
//
// When WindowServer crashes, macOS ends the login session. Processes started before it (a terminal's
// `claude agents` daemon and every background agent) keep running but lose the system services:
// getaddrinfo, TLS trust and user lookups fail while the network and DNS servers are fine. Agents then
// fail at random with "Could not resolve host". This check names the cause and the fix instead.
//
//   node scripts/doctor.mjs     exit 0: healthy or offline (a warning); exit 3: the session has ended

import { promises as dns } from "node:dns";
import { userInfo } from "node:os";
import { pathToFileURL } from "node:url";

const HOST = "github.com";

function within(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)),
  ]);
}

async function succeeds(probe, ms) {
  try {
    await within(probe(), ms);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe the session. Returns { ok, state: "healthy" | "offline" | "session-ended", detail }.
 * The probes are injectable; by default they are Node's user lookup, getaddrinfo and c-ares.
 */
export async function checkSession({
  platform = process.platform,
  userInfo: whoami = userInfo,
  lookup = (host) => dns.lookup(host),
  resolve4 = (host) => dns.resolve4(host),
  timeoutMs = 5_000,
} = {}) {
  if (platform !== "darwin") {
    return { ok: true, state: "healthy", detail: "not macOS: nothing to check" };
  }
  let user = null;
  try {
    user = whoami().username;
  } catch {
    // Reported below.
  }
  if (!user || /^\d+$/.test(user)) {
    return {
      ok: false,
      state: "session-ended",
      detail: `user lookup returned ${user ?? "an error"}`,
    };
  }
  if (await succeeds(() => lookup(HOST), timeoutMs)) {
    return { ok: true, state: "healthy", detail: `user ${user}, ${HOST} resolves` };
  }
  if (await succeeds(() => resolve4(HOST), timeoutMs)) {
    return {
      ok: false,
      state: "session-ended",
      detail: `DNS answers for ${HOST}, but the system resolver (getaddrinfo) does not`,
    };
  }
  return { ok: true, state: "offline", detail: `${HOST} does not resolve at all: no network` };
}

/** What to tell the person. */
export function report(result) {
  if (result.state === "healthy") return `doctor: healthy (${result.detail})`;
  if (result.state === "offline") {
    return `doctor: offline (${result.detail}). Local work goes on; GitHub, installs and pulls wait.`;
  }
  return [
    `doctor: this process lost its macOS login session (${result.detail}).`,
    "WindowServer probably crashed (ADR 0018); macOS then ends the login session, and every process",
    "started before it, like this agent, loses DNS, TLS and user lookups. It does not recover by itself:",
    "  1. Log in to the Mac again.",
    "  2. In a new Terminal, run `claude daemon stop --any` (or quit the agents' terminal and app).",
    "  3. Start the agents again; their worktrees and branches are intact.",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await checkSession();
  const text = report(result);
  if (result.ok) console.log(text);
  else console.error(text);
  process.exit(result.ok ? 0 : 3);
}
