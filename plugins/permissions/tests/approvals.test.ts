import { describe, expect, it } from "vitest";
import type { PermApprovalData, PermApprovalDoneData } from "../../../packages/bridge/src/index";
import { type Handlers, MANAGE, type Mounted, mount, plugin } from "./harness";

function core(extra: Handlers = {}): Handlers {
  return {
    "plugin.list": () => ({ plugins: [plugin("example.notes", "Notes", "ui")] }),
    "events.subscribe": () => ({ subscriptionId: "sub-1" }),
    "perm.list": () => ({ grants: [] }),
    "perm.approve": () => ({}),
    ...extra,
  };
}

const DIFF =
  "--- ~/Notes/a.md\n+++ ~/Notes/a.md\n@@ -1,2 +1,2 @@\n # Today\n-Buy milk\n+Buy oat milk\n";

const write = (approvalId: string, extra: Partial<PermApprovalData> = {}): PermApprovalData => ({
  approvalId,
  caller: "agent:mira",
  action: "fs.write",
  permission: { permission: "fs:write", paths: ["~/Notes/**"] },
  target: "~/Notes/a.md",
  preview: { kind: "diff", text: DIFF },
  size: 21,
  task: "t3",
  ...extra,
});

const spawn: PermApprovalData = {
  approvalId: "a-9",
  caller: "agent:theo",
  action: "proc.spawn",
  permission: { permission: "proc:spawn", commands: ["git"] },
  target: "git",
  preview: { kind: "command", text: "git push --force origin main" },
};

async function held(handlers: Handlers, ...approvals: PermApprovalData[]): Promise<Mounted> {
  const mounted = await mount(handlers);
  for (const data of approvals) mounted.host.emit({ event: "perm.approval", data });
  await mounted.settle();
  return mounted;
}

const done = (mounted: Mounted, data: PermApprovalDoneData) =>
  mounted.host.emit({ event: "perm.approval.done", data });

describe("the approval card (ADR 0078)", () => {
  it("names the agent, the action, the path, the size and the diff", async () => {
    const { host, view } = await held(core(), write("a-1"));
    expect(host.visible).toBe(true);
    expect(view.approvals.at(-1)).toMatchObject({
      kind: "approval",
      approvalId: "a-1",
      title: "Agent mira wants to write a file",
      caller: { id: "agent:mira", name: "Agent mira", kind: "Agent" },
      action: "Write a file",
      target: "~/Notes/a.md",
      size: "21 bytes",
      task: "Allow for this task: its other writes in ~/Notes/** until this turn ends.",
      waiting: 0,
    });
    expect(view.approvals.at(-1)).toHaveProperty("preview", {
      kind: "diff",
      truncated: false,
      lines: [
        { text: "--- ~/Notes/a.md", change: "file" },
        { text: "+++ ~/Notes/a.md", change: "file" },
        { text: "@@ -1,2 +1,2 @@", change: "hunk" },
        { text: " # Today", change: "same" },
        { text: "-Buy milk", change: "removed" },
        { text: "+Buy oat milk", change: "added" },
      ],
    });
  });

  it("asks before Eris remembers a fact, with the fact as its preview (ADR 0096)", async () => {
    const fact: PermApprovalData = {
      approvalId: "a-7",
      caller: "agent:eris",
      action: "memory.remember",
      permission: { permission: "memory:write" },
      target: "Prefers pnpm over npm",
      preview: { kind: "fact", text: "Prefers pnpm over npm" },
      task: "t3",
    };
    const { view } = await held(core(), fact);
    expect(view.approvals.at(-1)).toMatchObject({
      kind: "approval",
      approvalId: "a-7",
      action: "Remember",
      target: "Prefers pnpm over npm",
      task: "Allow for this task: the other facts it keeps until this turn ends.",
    });
    expect(view.approvals.at(-1)?.title).toMatch(/wants to remember this$/);
    expect(view.approvals.at(-1)).toHaveProperty("preview", {
      kind: "fact",
      truncated: false,
      lines: [{ text: "Prefers pnpm over npm", change: "same" }],
    });
  });

  it("answers Allow once, Allow for this task and Deny with perm.approve", async () => {
    const mounted = await held(core(), write("a-1"), write("a-2"), write("a-3"));
    const { app, host, view, params, settle } = mounted;
    for (const choice of ["once", "task", "deny"] as const) {
      await app.answer(choice);
      await settle();
      if (choice !== "deny") await app.answer("done");
      await settle();
    }
    expect(params("perm.approve")).toEqual([
      { approvalId: "a-1", answer: "once", scope: MANAGE },
      { approvalId: "a-2", answer: "task", scope: MANAGE },
      { approvalId: "a-3", answer: "deny", scope: MANAGE },
    ]);
    expect(view.statuses).toContain("Allowed Agent mira once: Write a file ~/Notes/a.md.");
    expect(view.statuses).toContain("Allowed Agent mira for this task: Write a file ~/Notes/a.md.");
    expect(view.statuses.at(-1)).toBe("Denied Agent mira: Write a file ~/Notes/a.md.");
    expect(view.approvals.at(-1)).toBeNull();
    expect(host.visible).toBe(false);
  });

  it("offers Allow for this task only with a task, and Escape denies", async () => {
    const { task: _none, ...bare } = write("a-1");
    const { app, view, params, settle } = await held(core(), bare);
    expect(view.approvals.at(-1)).toMatchObject({ approvalId: "a-1", task: null });
    await app.answer("task");
    await settle();
    expect(params("perm.approve")).toEqual([]);
    expect(app.key("Escape")).toBe(true);
    await settle();
    expect(params("perm.approve")).toEqual([{ approvalId: "a-1", answer: "deny", scope: MANAGE }]);
  });

  it("shows a spawn's command line", async () => {
    const { view } = await held(core(), spawn);
    expect(view.approvals.at(-1)).toMatchObject({
      title: "Agent theo wants to run a program",
      action: "Run a program",
      target: "git",
      size: "",
      task: null,
      preview: {
        kind: "command",
        truncated: false,
        lines: [{ text: "git push --force origin main", change: "same" }],
      },
    });
  });

  it("shows the path and the size written once an allowed write ran", async () => {
    const mounted = await held(core(), write("a-1"), spawn);
    const { app, view, params, settle } = mounted;
    await app.answer("once");
    await settle();
    expect(view.approvals.at(-1)).toMatchObject({
      kind: "result",
      approvalId: "a-1",
      title: "Agent mira is writing a file",
      text: "Writing ~/Notes/a.md…",
      undo: false,
    });
    done(mounted, { approvalId: "a-1", ok: true, bytesWritten: 21 });
    await settle();
    expect(view.approvals.at(-1)).toMatchObject({
      kind: "result",
      title: "Agent mira wrote a file",
      text: "Wrote 21 bytes to ~/Notes/a.md.",
      undo: false,
      waiting: 1,
    });
    expect(app.key("Escape")).toBe(true);
    await settle();
    expect(view.approvals.at(-1)).toMatchObject({ kind: "approval", approvalId: "a-9" });
    expect(params("cmd.undo")).toEqual([]);
  });

  it("says when an allowed write failed", async () => {
    const mounted = await held(core(), write("a-1"));
    done(mounted, {
      approvalId: "a-1",
      ok: false,
      error: { code: "io_error", message: "disk full" },
    });
    await mounted.app.answer("once");
    await mounted.settle();
    expect(mounted.view.approvals.at(-1)).toMatchObject({
      kind: "result",
      title: "Agent mira could not write a file",
      text: "Could not write ~/Notes/a.md: disk full.",
      undo: false,
    });
  });

  it("offers Undo only when the core can take the write back", async () => {
    const mounted = await held(core(), write("a-1"));
    await mounted.app.answer("once");
    await mounted.settle();
    done(mounted, { approvalId: "a-1", ok: true, bytesWritten: 21, undoable: true });
    await mounted.settle();
    expect(mounted.view.approvals.at(-1)).toMatchObject({ kind: "result", undo: true });
    await mounted.app.answer("undo");
    await mounted.settle();
    expect(mounted.methods()).toContain("cmd.undo");
    expect(mounted.view.approvals.at(-1)).toBeNull();
  });

  it("queues approvals with prompts, one card at a time", async () => {
    const mounted = await held(core(), write("a-1"));
    mounted.host.emit({
      event: "perm.prompt",
      data: {
        promptId: "p1",
        caller: "example.notes",
        permission: { permission: "fs:read", paths: ["~/Notes/**"] },
        duration: "session",
      },
    });
    await mounted.settle();
    expect(mounted.view.approvals.at(-1)).toMatchObject({ approvalId: "a-1", waiting: 1 });
    await mounted.app.answer("deny");
    await mounted.settle();
    expect(mounted.view.approvals.at(-1)).toBeNull();
    expect(mounted.view.prompts.at(-1)).toMatchObject({ promptId: "p1", waiting: 0 });
  });
});
