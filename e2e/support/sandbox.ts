// What e2e/specs/sandbox.spec.ts asks of the running CEF desk's processes (ADR 0148): its CEF
// subprocesses by type, from `ps`, and the kernel's answer about each one's sandbox, from the probe
// in sandbox-probe.c (macOS), which this module builds with cc into e2e/test-results.
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** One CEF subprocess of the desk. */
export interface Subprocess {
  pid: number;
  /** Chromium's `--type`: renderer, gpu-process, utility, ... */
  type: string;
  /** A utility's `--utility-sub-type` (network.mojom.NetworkService, ...), else undefined. */
  service?: string;
  /** A utility's `--service-sandbox-type` (network, service, none, ...), else undefined. */
  sandbox?: string;
  /** The helper app it runs from (`endue-desk Helper (Renderer).app`), else undefined. */
  helper?: string;
}

/** What the kernel says about one process: sandboxed at all, and per path read or write. */
export interface Probe {
  pid: number;
  sandboxed: boolean;
  read?: Record<string, "denied" | "allowed" | "missing" | "unknown">;
  write?: Record<string, "denied" | "allowed" | "missing" | "unknown">;
}

/**
 * The CEF subprocesses of `parent` in `ps -axo pid=,ppid=,args=` output: the children with a
 * `--type=` switch (a terminal's shell under the desk has none and is left out).
 */
export function subprocesses(ps: string, parent: number): Subprocess[] {
  const found: Subprocess[] = [];
  for (const line of ps.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!match || Number(match[2]) !== parent) continue;
    const args = match[3] as string;
    const type = /\s--type=([\w-]+)/.exec(args)?.[1];
    if (!type) continue;
    const service = /\s--utility-sub-type=([\w.]+)/.exec(args)?.[1];
    const sandbox = /\s--service-sandbox-type=(\w+)/.exec(args)?.[1];
    const helper = /\/([^/]*Helper[^/]*\.app)\//.exec(args)?.[1];
    found.push({ pid: Number(match[1]), type, service, sandbox, helper });
  }
  return found;
}

/** The desk's CEF subprocesses now. */
export function deskSubprocesses(desk: number): Subprocess[] {
  return subprocesses(execFileSync("ps", ["-axo", "pid=,ppid=,args="], { encoding: "utf8" }), desk);
}

/** The probe's binary in `results`, built from sandbox-probe.c when missing or older. */
export function probeBinary(results: string): string {
  const source = join(here, "sandbox-probe.c");
  const binary = join(results, "sandbox-probe");
  if (!existsSync(binary) || statSync(binary).mtimeMs < statSync(source).mtimeMs) {
    execFileSync("cc", ["-O2", "-Wall", "-Werror", "-o", binary, source], { stdio: "inherit" });
  }
  return binary;
}

/** Ask the kernel about `pid`: its sandbox, and whether it may read and write these paths. */
export function probe(
  binary: string,
  pid: number,
  paths: { read?: string[]; write?: string[] } = {},
): Probe {
  const args = [String(pid)];
  if (paths.read?.length) args.push("read", ...paths.read);
  if (paths.write?.length) args.push("write", ...paths.write);
  return JSON.parse(execFileSync(binary, args, { encoding: "utf8" })) as Probe;
}
