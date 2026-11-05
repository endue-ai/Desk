import { describe, expect, it } from "vitest";
import { emptyText, forgetAllQuestion, rows, writerName } from "../ui/model.js";

describe("the inspector's words", () => {
  it("names who kept an entry", () => {
    expect(writerName("person")).toBe("you");
    expect(writerName("eris")).toBe("Eris");
    expect(writerName("agent:ag_01")).toBe("agent ag_01");
    expect(writerName("endue.memory")).toBe("endue.memory");
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

  it("says what is empty and what forgetting everything means", () => {
    expect(emptyText("all", "")).toContain("remembers nothing yet");
    expect(emptyText("fact", "")).toContain("no facts");
    expect(emptyText("all", "tea")).toContain("“tea”");
    expect(forgetAllQuestion("fact")).toContain("every fact");
  });
});
