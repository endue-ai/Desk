// The real git program behind proc.spawn and proc.write, in a temporary repository, for the tests
// that must see what git does with a patch (hunks.test.ts). Output and the exit arrive as events, as
// the core sends them; `close` on proc.write ends stdin (ADR 0248).
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestHost } from "../../../packages/plugin-sdk/src/testing/index";
import type { Handlers } from "./harness";

export interface TempRepo {
  root: string;
  /** Run git there and answer what it wrote. */
  git(...args: string[]): string;
  write(path: string, text: string): void;
  read(path: string): string;
  remove(): void;
}

/** A repository with one commit of `files`, whose commits are made by the test identity. */
export function tempRepo(files: Record<string, string>): TempRepo {
  const root = mkdtempSync(join(tmpdir(), "endue-git-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C" },
    });
  git("init", "-q", "-b", "main");
  git("config", "user.name", "endue-team");
  git("config", "user.email", "team@endue.ai");
  git("config", "commit.gpgsign", "false");
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return {
    root,
    git,
    write: (path, text) => writeFileSync(join(root, path), text),
    read: (path) => readFileSync(join(root, path), "utf8"),
    remove: () => rmSync(root, { recursive: true, force: true }),
  };
}

export interface RealGit {
  handlers: Handlers;
  /** What each proc.write carried, in order. */
  writes: Array<{ data: string; close?: boolean }>;
  attach(host: TestHost): void;
}

export function realGit(): RealGit {
  let host: TestHost | undefined;
  let n = 0;
  const children = new Map<string, ChildProcess>();
  const writes: RealGit["writes"] = [];
  const emit = (event: Parameters<TestHost["emit"]>[0]) => host?.emit(event);
  const handlers: Handlers = {
    "proc.spawn": (params) => {
      const procId = `r${++n}`;
      const child = spawn(params.command, params.args ?? [], {
        cwd: params.cwd,
        env: { ...process.env, ...params.env },
      });
      children.set(procId, child);
      for (const stream of ["stdout", "stderr"] as const)
        child[stream]?.on("data", (chunk: Buffer) =>
          emit({
            event: "proc.output",
            data: { procId, stream, data: chunk.toString("base64"), encoding: "base64" },
          }),
        );
      child.on("close", (code) => {
        children.delete(procId);
        emit({ event: "proc.exit", data: { procId, code: code ?? 1 } });
      });
      return { procId, pid: child.pid ?? 0 };
    },
    "proc.write": ({ procId, data, close }) => {
      writes.push({ data, ...(close === undefined ? {} : { close }) });
      const child = children.get(procId);
      if (!child?.stdin) throw new Error(`no process ${procId}`);
      child.stdin.write(data);
      if (close) child.stdin.end();
      return {};
    },
    "proc.kill": ({ procId }) => {
      children.get(procId)?.kill();
      return {};
    },
  };
  return {
    handlers,
    writes,
    attach: (h) => {
      host = h;
    },
  };
}
