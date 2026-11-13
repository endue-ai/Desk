// @vitest-environment jsdom
// The card in front on the island (ADR 0204): the permissions plugin's words for a prompt and an
// approval, the same choices as its overlay, and the call each choice answers with.
import type { PermApprovalData, PermPromptData, PluginInfo } from "@endue-ai/bridge";
import { describe, expect, it, vi } from "vitest";
import { answerCall, cardOf, renderCard, titleOf } from "./island-card";
import { approvalAsk, promptAsk } from "./island-model";

const notes: PluginInfo = {
  id: "example.notes",
  status: "ready",
  enabled: true,
  builtIn: false,
  revision: 1,
  manifest: {
    id: "example.notes",
    name: "Notes",
    version: "0.1.0",
    kind: "ui",
    entry: "ui/index.html",
  },
};

const prompt: PermPromptData = {
  promptId: "p-1",
  caller: "example.notes",
  permission: { permission: "fs:read", paths: ["~/Notes/**"] },
  reason: "To index your notes",
  duration: "session",
};

const write: PermApprovalData = {
  approvalId: "a-1",
  caller: "agent:mira",
  action: "fs.write",
  permission: { permission: "fs:write", paths: ["~/Notes/**"] },
  target: "~/Notes/a.md",
  preview: { kind: "diff", text: "--- a\n+++ a\n@@ -1 +1 @@\n-Buy milk\n+Buy oat milk\n" },
  size: 21,
  task: "t-3",
};

const MANAGE = { permission: "perm:manage" };

describe("the island's card", () => {
  it("says a prompt as the permissions overlay does, with its choices", () => {
    const card = cardOf(promptAsk(prompt), [notes], 2);
    expect(card.model).toMatchObject({
      title: "Notes asks for permission",
      caller: { id: "example.notes", name: "Notes", kind: "UI plugin" },
      permission: "Read files",
      scope: "~/Notes/**",
      reason: "To index your notes",
      duration: "This session",
      waiting: 2,
    });
    expect(card.choices.map((c) => c.answer)).toEqual(["once", "session", "always", "refuse"]);
    expect(card.choices.at(-1)).toMatchObject({ label: "Don't allow", refuses: true });
    // The parent folder, when the core offers it, is a second way to allow.
    const parent = { ...prompt, parent: { permission: "fs:read" as const, paths: ["~/**"] } };
    const offered = cardOf(promptAsk(parent), [notes], 0);
    expect(offered.choices.map((c) => c.answer)).toContain("parent");
  });

  it("says an approval as the overlay does, with Allow for this task only in a task", () => {
    const card = cardOf(approvalAsk(write), [], 0);
    expect(card.model).toMatchObject({
      title: "Agent mira wants to write a file",
      action: "Write a file",
      target: "~/Notes/a.md",
      size: "21 bytes",
    });
    expect(card.choices.map((c) => c.answer)).toEqual(["once", "task", "deny"]);
    const { task: _task, ...alone } = write;
    expect(cardOf(approvalAsk(alone), [], 0).choices.map((c) => c.answer)).toEqual([
      "once",
      "deny",
    ]);
    expect(titleOf(approvalAsk(write), [])).toBe("Agent mira wants to write a file");
  });

  it("answers each choice with the core's call, and none it does not take", () => {
    const ask = promptAsk(prompt);
    expect(answerCall(ask, "session")).toEqual({
      method: "perm.answer",
      params: { promptId: "p-1", granted: true, duration: "session", scope: MANAGE },
    });
    expect(answerCall(ask, "refuse")).toEqual({
      method: "perm.answer",
      params: { promptId: "p-1", granted: false, scope: MANAGE },
    });
    expect(answerCall(ask, "parent"), "no parent offered").toBeUndefined();
    expect(answerCall(ask, "task")).toBeUndefined();
    expect(answerCall(approvalAsk(write), "task")).toEqual({
      method: "perm.approve",
      params: { approvalId: "a-1", answer: "task", scope: MANAGE },
    });
    const { task: _task, ...alone } = write;
    expect(answerCall(approvalAsk(alone), "task")).toBeUndefined();
    expect(answerCall(approvalAsk(write), "always")).toBeUndefined();
  });

  it("draws the card with its preview lines marked and hands the pressed choice on", () => {
    const answer = vi.fn();
    const box = renderCard(document, cardOf(approvalAsk(write), [], 1), answer);
    expect(box.querySelector(".island-card-title")?.textContent).toBe(
      "Agent mira wants to write a file",
    );
    const lines = [...box.querySelectorAll(".island-card-preview span")].map((s) => s.className);
    expect(lines).toEqual([
      "island-line-file",
      "island-line-file",
      "island-line-hunk",
      "island-line-removed",
      "island-line-added",
    ]);
    expect(box.textContent).toContain("1 more waits");
    box.querySelector<HTMLButtonElement>("[data-answer=deny]")?.click();
    expect(answer).toHaveBeenCalledWith("deny");
  });
});
