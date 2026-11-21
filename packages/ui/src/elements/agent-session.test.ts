// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { appendSessionRun, defineElements, nativeSessionTurns, type SessionTurn } from "./index";

defineElements();
afterEach(() => document.body.replaceChildren());
const row = {
  key: "first",
  title: "Review the outline",
  agent: "writer",
  agentName: "Writer",
  sources: ["local"],
  workspace: "/sample/notebook",
};
const other = { ...row, key: "second", title: "Check the captions" };
const turn = (id: string, role: string, text: string) => ({ id, role, text });
function mounted(extra: object) {
  const reader = document.createElement("desk-agent-session");
  document.body.append(reader);
  const draw = (changes: object = {}) =>
    Object.assign(reader, {
      view: { rows: [row, other], selected: row, turns: [], ...extra, ...changes },
    });
  draw();
  expect(reader.shadowRoot, "the shared session workspace is mounted").toBeTruthy();
  return { root: reader.shadowRoot as ShadowRoot, draw };
}
const button = (root: ParentNode, label: string) => {
  const found = [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label || b.getAttribute("aria-label") === label,
  );
  if (!found) throw Error(`Missing button ${label}`);
  return found;
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
it("reads mixed turns in order", () => {
  const turns = [
    turn("1", "user", "Compare the outlines."),
    turn("2", "tool", "notes.txt"),
    turn("3", "tool", "chapter.txt"),
    turn(
      "4",
      "assistant",
      "## Result\n\n- First\n- Second\n\n```text\nalpha\n```\n\n![figure](https://example.invalid/figure)",
    ),
    turn("5", "failure", "The chapter could not be read."),
    {
      ...turn("6", "plan", "Outline"),
      steps: [
        { text: "Read chapter", state: "done" },
        { text: "Check notes", state: "pending" },
      ],
    },
    { ...turn("7", "user", "<task-notification>Stored question</task-notification>"), cut: true },
    turn("8", "record", "<figure>original record</figure>"),
  ];
  const { root, draw } = mounted({ turns });
  const log = root.querySelector('[role="log"]')!;
  const fold = log.querySelector("details")!;
  expect(fold.querySelector("summary")?.textContent).toContain("2 tool calls");
  expect(fold.textContent).toContain("chapter.txt");
  fold.open = true;
  draw({ turns: [...turns, turn("9", "assistant", "Finished.")] });
  expect(log.querySelector("details")).toBe(fold);
  expect(fold.open).toBe(true);
  const md = log.querySelector("desk-markdown")?.shadowRoot;
  expect(md?.querySelector("h2")?.textContent).toBe("Result");
  expect(md?.querySelectorAll("li")).toHaveLength(2);
  expect(md?.querySelector("pre code")?.textContent).toContain("alpha");
  expect(md?.querySelector("img")).toBeNull();
  expect(log.textContent).toContain("The chapter could not be read.");
  expect(log.textContent).toContain("1/2");
  expect(log.textContent).toContain("Stored question");
  expect(log.textContent).toContain("Message clipped");
  expect(log.querySelector("figure,task-notification")).toBeNull();
});
it("answers a current request exactly once and scopes acknowledgements to the request", async () => {
  let acknowledge = () => {};
  const respond = vi
    .fn()
    .mockRejectedValueOnce(Error("Try again"))
    .mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          acknowledge = resolve;
        }),
    );
  const request = {
    id: "live-1",
    text: "Include the final heading?",
    choices: [
      { id: "yes", label: "Include" },
      { id: "later", label: "Defer" },
    ],
    respond,
  };
  const { root, draw } = mounted({ request });
  button(root, "Task details").click();
  button(root, "View request").click();
  expect(root.querySelectorAll('[data-choice="yes"]')).toHaveLength(1);
  button(root, "Include").click();
  await tick();
  expect(root.textContent).toContain("Try again");
  const yes = button(root, "Include");
  yes.click();
  yes.click();
  expect(respond).toHaveBeenCalledTimes(2);
  draw({ selected: other, request: undefined });
  acknowledge();
  await tick();
  expect(root.querySelector("[data-choice]")).toBeNull();
  draw({ selected: row, request });
  expect(root.querySelector("[data-choice]")).toBeNull();
  expect(root.textContent).toContain("Include");
  draw({ request: { ...request, id: "historical", respond: undefined } });
  expect(root.querySelector("[data-choice]")).toBeNull();
});

it("recognizes a complete named plan and keeps quoted or clipped data in its original role", async () => {
  const { nativeSessionTurns } = await import("./index");
  const text = JSON.stringify({
    items: [
      { content: "Read notes", status: "completed" },
      { content: "Check the title", status: "pending" },
    ],
  });
  const events = nativeSessionTurns([
    { role: "tool", name: "update_plan", text },
    { role: "user", text },
    { role: "tool", name: "update_plan", text, cut: true },
  ]);
  expect(events.map((t) => t.role)).toEqual(["plan", "user", "tool"]);
  expect(events[0]?.steps).toHaveLength(2);
  expect(events[2]).toMatchObject({ text, cut: true });
});

it("reconciles a partially written native transcript with the final streamed answer", () => {
  const run = {
    runId: "run-a",
    agent: "claude",
    caller: "desk",
    prompt: "Review outline",
    cwd: "/sample",
    access: "read-only",
    state: "done",
    startedAt: "2026-01-02T08:00:00Z",
    text: "First\n\nLast",
    tools: 1,
  } as const;
  const messages = [
    { role: "user", text: run.prompt, at: run.startedAt },
    { role: "tool", name: "Read", text: "outline.txt" },
    { role: "assistant", text: "First" },
  ] as const;
  const parts: SessionTurn[] = [
    { ...messages[1], id: "tool" },
    { ...messages[2], id: "first" },
  ];
  const partial = nativeSessionTurns([...messages]);
  appendSessionRun(partial, run, parts);
  expect(partial.map((t) => t.text)).toEqual([run.prompt, "outline.txt", "First", "Last"]);
  const written = nativeSessionTurns([...messages, { role: "assistant", text: "Last" }]);
  const previous = [...written];
  appendSessionRun(written, run, parts);
  expect(written).toEqual(previous);
});
