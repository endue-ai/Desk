// The person's Discard asks before a written draft goes (#404): "Discard this draft?" with Discard and
// Keep in the palette, Keep and a closed palette keep it, and an empty draft goes without a question.
// The agent command endue.mail.discard never asks: agents have their own approval path.
import { describe, expect, it } from "vitest";
import { mount } from "./harness";

const QUESTION = {
  title: "Discard this draft?",
  items: [
    { id: "discard", label: "Discard" },
    { id: "keep", label: "Keep" },
  ],
};

/** The palette answers `answer` (undefined closes it) and remembers what it was asked. */
async function writing(answer: string | undefined, fields: Record<string, string>) {
  const asked: unknown[] = [];
  const mounted = await mount({
    pick: (args) => {
      asked.push(args);
      return answer;
    },
  });
  await mounted.host.command("endue.mail.compose", {});
  mounted.app.writing.edit(fields);
  return { ...mounted, asked };
}

describe("discarding a draft", () => {
  for (const field of ["to", "cc", "bcc", "subject", "body"])
    it(`asks first when the ${field} holds text, and Discard removes it`, async () => {
      const { app, view, asked } = await writing("discard", { [field]: "x" });
      expect(await app.writing.confirmDiscard()).toBe(true);
      expect(asked).toEqual([QUESTION]);
      expect(view.draft()).toBeNull();
    });

  it("Keep leaves the draft open", async () => {
    const { app, view, asked } = await writing("keep", { subject: "Lunch" });
    expect(await app.writing.confirmDiscard()).toBe(false);
    expect(asked).toEqual([QUESTION]);
    expect(view.draft()).toMatchObject({ subject: "Lunch" });
  });

  it("closing the palette is Keep", async () => {
    const { app, view, asked } = await writing(undefined, { body: "Hello" });
    expect(await app.writing.confirmDiscard()).toBe(false);
    expect(asked).toHaveLength(1);
    expect(view.draft()).toMatchObject({ body: "Hello" });
  });

  it("an empty draft goes without a question", async () => {
    const { app, view, asked } = await writing("keep", { to: " ", subject: "", body: "\n\n" });
    expect(await app.writing.confirmDiscard()).toBe(true);
    expect(asked).toEqual([]);
    expect(view.draft()).toBeNull();
  });

  it("the agent command endue.mail.discard does not ask", async () => {
    const { host, view, asked } = await writing("keep", { subject: "Lunch", body: "Hello" });
    expect(await host.command("endue.mail.discard")).toBe(true);
    expect(asked).toEqual([]);
    expect(view.draft()).toBeNull();
  });
});
