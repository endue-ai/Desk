import { describe, expect, it } from "vitest";
import { mounted } from "./conversation-harness";

describe("readable Eris conversation", () => {
  it("keeps both exchanges and combines streamed deltas once without moving input focus", async () => {
    const h = mounted();
    h.input.focus();
    await h.send("first question");
    h.emit("started");
    h.emit("delta", "first ");
    h.emit("delta", "answer");
    h.emit("completed");
    await h.send("second question");
    h.emit("started");
    h.emit("delta", "second answer");
    h.emit("completed");
    h.emit("completed");
    expect(h.text()).toContain("first question");
    expect(h.text()).toContain("first answer");
    expect(h.text()).toContain("second question");
    expect(h.text().match(/second answer/g)).toHaveLength(1);
    expect(h.doc.activeElement).toBe(h.input);
  });

  it("restores only the last 50 messages through a frame reload without sending them again", async () => {
    const h = mounted();
    for (let i = 0; i < 26; i++) {
      await h.send(`question ${i}`);
      h.emit("started");
      h.emit("delta", `answer ${i}`);
      h.emit("completed");
    }
    const restored = mounted({ saved: h.saved() });
    expect(restored.doc.querySelectorAll("#conversation article")).toHaveLength(50);
    expect(restored.text()).not.toContain("question 0");
    expect(restored.text()).toContain("question 25");
    expect(restored.calls).toHaveLength(0);
  });

  it("keeps the question and visible failure when the brain rejects a send", async () => {
    const h = mounted({ failSend: true });
    await h.send("keep my question");
    expect(h.input.value).toBe("keep my question");
    expect(h.text()).toContain("keep my question");
    expect(h.text()).toContain("Something went wrong");
  });

  it("keeps offline progress and renders answer markup only as text", async () => {
    const h = mounted();
    await h.send("hello");
    h.emit("offline", "Waiting for connection");
    expect(h.text()).toContain("Waiting for connection");
    h.emit("online");
    h.emit("started");
    h.emit("delta", '<img src=x onerror="alert(1)">');
    h.emit("completed");
    expect(h.text()).toContain('<img src=x onerror="alert(1)">');
    expect(h.doc.querySelectorAll("#conversation img")).toHaveLength(0);
  });
});
