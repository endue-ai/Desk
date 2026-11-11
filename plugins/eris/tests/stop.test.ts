// @vitest-environment jsdom
// The Eris window while she answers (#161, finding 12): a Stop while it streams, and a long answer
// shown once, in the history, not again as soul text in a strip of its own.
import { describe, expect, it } from "vitest";
import { mounted } from "./conversation-harness";

const button = (h: ReturnType<typeof mounted>, id: string) =>
  h.doc.getElementById(id) as HTMLButtonElement;

describe("stopping Eris while she answers", () => {
  it("offers Stop only while she answers; Stop keeps what came and frees the field", async () => {
    const h = mounted();
    expect(button(h, "stop").hidden).toBe(true);
    await h.send("a long question");
    h.emit("started");
    h.emit("delta", "the first half ");
    expect(button(h, "stop").hidden).toBe(false);
    expect(button(h, "stop").disabled).toBe(false);
    expect(h.doc.querySelector<HTMLButtonElement>(".send")?.disabled).toBe(true);
    await h.click("stop");
    expect(h.text()).toContain("the first half");
    expect(h.text()).toContain("Stopped.");
    expect(button(h, "stop").hidden).toBe(true);
    expect(h.doc.querySelector<HTMLButtonElement>(".send")?.disabled).toBe(false);
    expect(h.doc.activeElement).toBe(h.input);
    // The rest of the stopped turn never shows.
    h.emit("delta", "and the second half");
    h.emit("completed");
    expect(h.text()).not.toContain("second half");
    expect(h.saved()).toMatchObject({ conversation: { version: 1 } });
  });

  it("Escape in the field stops her too, and the next question is answered", async () => {
    const h = mounted();
    await h.send("first");
    h.emit("started");
    h.emit("delta", "partial ");
    h.input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(h.text()).toContain("Stopped.");
    await h.send("second");
    h.emit("started");
    h.emit("delta", "the second answer");
    h.emit("completed");
    expect(h.text()).toContain("the second answer");
    expect(button(h, "stop").hidden).toBe(true);
  });
});

describe("a long answer", () => {
  it("is shown once: the history holds it, her soul text only says short ones", async () => {
    const h = mounted();
    await h.send("say a lot");
    h.emit("started");
    const long = "word ".repeat(40);
    h.emit("delta", long);
    h.emit("completed");
    expect(h.text()).toContain(long.trim());
    expect(h.doc.querySelectorAll("#answer .word")).toHaveLength(0);
    await h.send("say a little");
    h.emit("started");
    h.emit("delta", "A short answer.");
    h.emit("completed");
    expect([...h.doc.querySelectorAll("#answer .word")].map((w) => w.textContent)).toEqual([
      "A",
      "short",
      "answer.",
    ]);
  });
});
