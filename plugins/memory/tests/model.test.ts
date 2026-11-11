import { describe, expect, it } from "vitest";
import { emptyText, forgetAllQuestion, forgotText, LONG, rows, writerName } from "../ui/model.js";
import { longEpisode } from "./fixtures";

describe("the inspector's words", () => {
  it("names who kept an entry in words, never by a plugin id", () => {
    expect(writerName("person")).toBe("you");
    expect(writerName("endue.memory")).toBe("you");
    expect(writerName("eris")).toBe("Eris");
    expect(writerName("agent:ag_01")).toBe("agent ag_01");
    expect(writerName("endue.notes")).toBe("the Notes plugin");
    expect(writerName("acme.daily-notes")).toBe("the Daily notes plugin");
  });

  it("keeps a search's snippet on its row and leaves the text as it was written", () => {
    const fact = {
      kind: "fact",
      id: "fact_1",
      text: "<b>bold</b>",
      by: "person",
      at: "2026-11-05T00:00:00Z",
    } as const;
    expect(rows([fact], new Map([["fact_1", "[bold]"]]))).toEqual([
      expect.objectContaining({ id: "fact_1", text: "<b>bold</b>", snippet: "[bold]", tags: [] }),
    ]);
  });

  it("marks an entry too long to show whole, by what was asked and answered together", () => {
    const short = {
      kind: "fact",
      id: "f",
      text: "Likes tea",
      by: "eris",
      at: "2026-11-05T00:00:00Z",
    } as const;
    const wordy = { ...short, id: "g", text: "a".repeat(LONG + 1) };
    const [a, b, c] = rows([short, wordy, longEpisode()]);
    expect([a?.long, b?.long, c?.long]).toEqual([false, true, true]);
  });

  it("says what is empty", () => {
    expect(emptyText("all", "")).toContain("remembers nothing yet");
    expect(emptyText("fact", "")).toContain("no facts");
    expect(emptyText("all", "tea")).toContain("“tea”");
  });

  it("asks before forgetting everything, naming the kind and how many when all are shown", () => {
    expect(forgetAllQuestion({ filter: "fact", count: 2, more: false, query: "" })).toEqual({
      title: "Forget every fact?",
      text: "Eris will no longer know the 2 facts she keeps about you. This cannot be undone.",
      yes: "Forget 2 facts",
    });
    expect(
      forgetAllQuestion({ filter: "episode", count: 1, more: false, query: "" }),
    ).toMatchObject({
      title: "Forget every conversation?",
      text: expect.stringContaining("the one conversation"),
      yes: "Forget 1 conversation",
    });
    const all = forgetAllQuestion({ filter: "all", count: 3, more: false, query: "" });
    expect(all).toMatchObject({ title: "Forget everything?", yes: "Forget everything" });
    expect(all.text).toContain("the 3 entries");
    // A page cut short or a search: the count shown is not all of them, so none is said.
    const more = forgetAllQuestion({ filter: "fact", count: 200, more: true, query: "" });
    expect(more).toMatchObject({
      yes: "Forget every fact",
      text: expect.not.stringContaining("200"),
    });
    const search = forgetAllQuestion({ filter: "fact", count: 1, more: false, query: "pnpm" });
    expect(search.text).toContain("All of them, not only those that match “pnpm”.");
    expect(search.yes).toBe("Forget every fact");
  });

  it("says what was forgotten", () => {
    expect(forgotText("fact", 2)).toBe("Forgot 2 facts.");
    expect(forgotText("episode", 1)).toBe("Forgot 1 conversation.");
    expect(forgotText("all", 3)).toBe("Forgot 3 entries.");
    expect(forgotText("all", 0)).toBe("There was nothing to forget.");
  });
});
