// The card an agent's act waits on (ADR 0078, ADR 0123), as the permissions plugin draws it: what
// she wants to do, in which app, the act in words, and that "Allow for this task" covers that app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approvalModel } from "../../permissions/ui/approval.js";

const root = join(import.meta.dirname, "../../..");
const vector = JSON.parse(
  readFileSync(
    join(root, "specs/bridge/v0/vectors/valid/computer-perm-approval-event.json"),
    "utf8",
  ),
);

describe("the approval card for an act on the computer", () => {
  it("names the act and the app, and what Allow for this task lets through", () => {
    const card = approvalModel(vector.instance.data, [], 0);
    expect(card.title).toBe("Agent eris wants to click");
    expect(card.action).toBe("Click in");
    expect(card.target).toBe("Safari (com.apple.Safari)");
    expect(card.preview?.lines.map((l) => l.text)).toEqual([
      "double-click left at (120, 340) in Safari",
    ]);
    expect(card.task).toBe(
      "Allow for this task: its other input to Safari (com.apple.Safari) until this turn ends.",
    );
  });

  it("has words for every act an agent can ask for", () => {
    const acts = [
      ["computer.input.type", "Agent eris wants to type"],
      ["computer.input.keys", "Agent eris wants to press keys"],
      ["computer.ax.perform", "Agent eris wants to press a control"],
      ["computer.apps.launch", "Agent eris wants to open an app"],
      ["computer.apps.quit", "Agent eris wants to quit an app"],
    ];
    for (const [action, title] of acts) {
      const card = approvalModel({ ...vector.instance.data, action }, [], 0);
      expect(card.title, action).toBe(title);
    }
  });
});
