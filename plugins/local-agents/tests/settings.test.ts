import { describe, expect, it } from "vitest";
import { readConversation, storedConversation } from "../ui/chat.js";
import { actionFor, hints } from "../ui/keys.js";
import { duration, metaOf } from "../ui/model.js";
import { DEFAULTS, fromValues } from "../ui/settings.js";
import { clip, fitList, sizeOf, VALUE_LIMIT } from "../ui/store.js";

describe("fromValues", () => {
  it("takes values of the right type, range and choice, and keeps the default otherwise", () => {
    expect(fromValues({})).toEqual(DEFAULTS);
    expect(
      fromValues({
        "endue.local-agents.path": "/opt/tools/bin:/usr/bin",
        "endue.local-agents.folder": "~/code",
        "endue.local-agents.access": "agent",
        "endue.local-agents.timeout": 0,
        "endue.local-agents.parallel": 4,
        "endue.local-agents.agent": "gemini",
        "endue.local-agents.confirm": false,
      }),
    ).toEqual({
      path: "/opt/tools/bin:/usr/bin",
      folder: "~/code",
      access: "agent",
      timeout: 0,
      parallel: 4,
      agent: "gemini",
      confirm: false,
    });
    expect(
      fromValues({
        "endue.local-agents.access": "root",
        "endue.local-agents.parallel": 99,
        "endue.local-agents.timeout": 2.5,
        "endue.local-agents.agent": "hal",
        "endue.local-agents.confirm": "no",
      }),
    ).toEqual(DEFAULTS);
  });
});

describe("what the store keeps", () => {
  it("cuts a long conversation to fit the desk's 64 KiB, the oldest messages first", () => {
    const messages = Array.from({ length: 150 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 ? "agent" : "user") as "agent" | "user",
      text: `${i} ${"x".repeat(2_000)}`,
      at: i,
      run: "r1",
    }));
    const stored = storedConversation({ agent: "claude", session: "s", model: "", messages });
    expect(sizeOf(stored)).toBeLessThanOrEqual(VALUE_LIMIT);
    expect(stored.messages.at(-1)?.id).toBe("m149");
    expect(stored.messages[0]?.id).not.toBe("m0");
    expect(stored.messages[0]).not.toHaveProperty("run");
    expect(readConversation("claude", stored).messages).toHaveLength(stored.messages.length);
    expect(readConversation("claude", { session: "--bad", messages: [{ id: 1 }] })).toEqual({
      agent: "claude",
      session: "",
      model: "",
      messages: [],
    });
  });

  it("clips long texts and fits lists", () => {
    expect(clip("abcdef", 3)).toBe("abc\n\n[… cut to keep]");
    expect(fitList([1, 2, 3, 4], (l) => ({ l }), sizeOf({ l: [3, 4] }))).toEqual([3, 4]);
  });
});

describe("keys and words", () => {
  it("map single keys per view, and leave chords to the desk", () => {
    expect(actionFor("chat", { key: "3" })).toEqual({ action: "compare" });
    expect(actionFor("board", { key: "r" })).toEqual({ action: "runSelected" });
    expect(actionFor("board", { key: "ArrowLeft" })).toEqual({ action: "move", args: ["left"] });
    expect(actionFor("chat", { key: "ArrowLeft" })).toBeUndefined();
    expect(actionFor("board", { key: "r", metaKey: true })).toBeUndefined();
    expect(actionFor("activity", { key: "X" })).toEqual({ action: "stopAll" });
    expect(hints("board")).toContain("[ ] move");
  });

  it("say how long a run took and what it cost", () => {
    expect(duration(0)).toBe("");
    expect(duration(12)).toBe("0.1 s");
    expect(duration(3_240)).toBe("3.2 s");
    expect(duration(95_000)).toBe("1 min 35 s");
    expect(metaOf(3_240, { input: 1_200, output: 34, cost: 0.0123 })).toBe(
      "3.2 s · 1,234 tokens · $0.012",
    );
  });
});
