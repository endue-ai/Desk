import { describe, expect, it } from "vitest";
import { mounted } from "./conversation-harness";

describe("explicit Eris file context", () => {
  it("reads only a chosen open file under its exact scope and sends visible context only on Send", async () => {
    const h = mounted();
    expect(h.calls).toHaveLength(0);
    await h.click("attach-file");
    expect(h.commands.run).toHaveBeenCalledWith("desk.buffers.list");
    expect(h.calls.find((c) => c.method === "fs.read")?.params).toMatchObject({
      path: "~/notes.txt",
      offset: 0,
      length: 16384,
      scope: { permission: "fs:read", paths: ["~/notes.txt"] },
    });
    expect(h.doc.getElementById("attachment")?.textContent).toContain("hello from the file");
    expect(h.calls.some((c) => c.method === "brain.say")).toBe(false);
    await h.send("Summarize it");
    const payload = h.calls.find((c) => c.method === "brain.say")?.params.text;
    expect(payload).toContain("Summarize it");
    expect(payload).toContain("hello from the file");
  });

  it("removing the attachment excludes it from the message", async () => {
    const h = mounted();
    await h.click("attach-file");
    await h.click("remove-attachment");
    await h.send("hello");
    expect(h.calls.find((c) => c.method === "brain.say")?.params.text).toBe("hello");
  });

  it("cancellation or an unavailable binary file never reads a file", async () => {
    for (const options of [
      { pick: null },
      { files: [{ path: "~/file.pdf" }], pick: "~/file.pdf" },
    ]) {
      const h = mounted(options);
      await h.click("attach-file");
      expect(h.calls.some((c) => c.method === "fs.read")).toBe(false);
    }
  });

  it("declined permission never retries the read or attaches content", async () => {
    const h = mounted({
      granted: false,
      read: () => {
        throw { code: "permission_denied" };
      },
    });
    await h.click("attach-file");
    expect(h.calls.filter((c) => c.method === "fs.read")).toHaveLength(1);
    expect(h.calls.find((c) => c.method === "perm.request")?.params.permission).toEqual({
      permission: "fs:read",
      paths: ["~/notes.txt"],
    });
    await h.send("hello");
    expect(h.calls.find((c) => c.method === "brain.say")?.params.text).toBe("hello");
  });

  it("labels a bounded excerpt and refuses an oversized message without changing the question", async () => {
    const h = mounted({
      read: () => ({ content: "a".repeat(16384), size: 32000, encoding: "utf8" }),
    });
    await h.click("attach-file");
    expect(h.doc.getElementById("attachment")?.textContent).toContain("excerpt");
    await h.send("q".repeat(7900));
    expect(h.calls.some((c) => c.method === "brain.say")).toBe(false);
    expect(h.input.value).toBe("q".repeat(7900));
    await h.send("Summarize");
    const text = String(h.calls.find((c) => c.method === "brain.say")?.params.text);
    expect(text.length).toBeLessThanOrEqual(8000);
    expect(text).toContain("excerpt");
  });
});
