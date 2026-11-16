// Threads as trees of versions, their list's groups and titles, and model names made readable.
import { describe, expect, it } from "vitest";
import {
  capsFromName,
  formatBytes,
  formatContext,
  paramsOf,
  prettyName,
  quantOf,
} from "../ui/models.js";
import {
  addNode,
  branchOf,
  createThread,
  entryOf,
  groupThreads,
  path,
  pathTo,
  removeNode,
  switchBranch,
  titleFrom,
} from "../ui/threads.js";

describe("threads", () => {
  it("keeps every version and shows the chosen path", () => {
    const t = createThread({ model: "s|m" });
    const q = addNode(t, null, { role: "user", content: "Q" });
    const a1 = addNode(t, q.id, { role: "assistant", content: "A1" });
    const a2 = addNode(t, q.id, { role: "assistant", content: "A2" });
    expect(path(t).map((n) => n.content)).toEqual(["Q", "A2"]);
    expect(branchOf(t, a2)).toEqual({ index: 2, count: 2 });
    switchBranch(t, a2.id, -1);
    expect(path(t).map((n) => n.content)).toEqual(["Q", "A1"]);
    const q2 = addNode(t, a1.id, { role: "user", content: "Q2" });
    expect(pathTo(t, q2.id).map((n) => n.content)).toEqual(["Q", "A1", "Q2"]);
    removeNode(t, a1.id);
    expect(path(t).map((n) => n.content)).toEqual(["Q", "A2"]);
    expect(t.nodes[q2.id]).toBeUndefined();
  });

  it("edits a first question as a sibling at the root", () => {
    const t = createThread();
    const q = addNode(t, null, { role: "user", content: "first" });
    addNode(t, null, { role: "user", content: "first, edited" });
    expect(path(t)[0].content).toBe("first, edited");
    switchBranch(t, path(t)[0].id, -1);
    expect(path(t)[0].id).toBe(q.id);
  });

  it("titles from the first line and keeps a preview", () => {
    expect(titleFrom("How do I\n  sort a list?")).toBe("How do I sort a list?");
    expect(titleFrom("a ".repeat(40))).toMatch(/…$/);
    const t = createThread();
    addNode(t, null, { role: "user", content: "hello   there" });
    expect(entryOf(t).preview).toBe("hello there");
  });

  it("groups by day, pinned first", () => {
    const now = new Date(2026, 10, 17, 15).getTime();
    const day = 86_400_000;
    const e = (id: string, at: number, pinned = false) => ({
      id,
      title: id,
      createdAt: at,
      updatedAt: at,
      pinned,
    });
    const groups = groupThreads(
      [
        e("a", now),
        e("b", now - day),
        e("c", now - 3 * day),
        e("d", now - 20 * day),
        e("p", now - 90 * day, true),
        e("o", now - 90 * day),
      ],
      now,
    );
    expect(groups.map(([g, list]) => [g, list.map((x) => x.id)])).toEqual([
      ["Pinned", ["p"]],
      ["Today", ["a"]],
      ["Yesterday", ["b"]],
      ["Previous 7 days", ["c"]],
      ["Previous 30 days", ["d"]],
      ["August 2026", ["o"]],
    ]);
  });
});

describe("model names", () => {
  it("reads names, sizes and quantizations", () => {
    expect(prettyName("qwen2.5-coder:7b-instruct-q4_K_M")).toBe("Qwen2.5 Coder 7B Instruct");
    expect(prettyName("hf.co/bartowski/SmolLM2-135M-Instruct-GGUF:Q8_0")).toBe(
      "SmolLM2 135M Instruct",
    );
    expect(prettyName("llama3.2:latest")).toBe("Llama3.2");
    expect(quantOf("Mistral-7B-Instruct-v0.3.Q5_K_S.gguf")).toBe("Q5_K_S");
    expect(quantOf("model-IQ4_XS.gguf")).toBe("IQ4_XS");
    expect(paramsOf("mixtral:8x7b")).toBe("8x7B");
    expect(paramsOf("SmolLM2-135M-Instruct")).toBe("135M");
  });

  it("guesses what a model can do from its name", () => {
    expect(capsFromName("nomic-embed-text")).toEqual(["embedding"]);
    expect(capsFromName("qwen2.5-coder:7b")).toEqual(["tools", "code"]);
    expect(capsFromName("deepseek-r1:14b")).toEqual(["reasoning"]);
    expect(capsFromName("gemma3:4b")).toEqual(["vision"]);
  });

  it("formats bytes and context lengths", () => {
    expect(formatBytes(4_683_087_332)).toBe("4.7 GB");
    expect(formatBytes(274_302_450)).toBe("274 MB");
    expect(formatContext(131072)).toBe("128K");
    expect(formatContext(40960)).toBe("40K");
  });
});
