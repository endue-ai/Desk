// Pasting into the terminal (#538, TERM-I02): several lines into a program that did not turn on
// bracketed paste would run each line as it arrives, so the person is asked first; a paste can never
// end bracketed paste early; the endue.terminal.paste-warning setting says when to ask.
import { describe, expect, it } from "vitest";
import { createPasteGuard, preparePaste } from "../ui/paste.js";

function guard(options: {
  bracketed?: boolean;
  warn?: "auto" | "always" | "never";
  yes?: boolean;
}) {
  const pasted: string[] = [];
  const asked: Array<{ text: string; lines: number }> = [];
  const g = createPasteGuard({
    paste: (text) => pasted.push(text),
    ask: async (text, lines) => {
      asked.push({ text, lines });
      return options.yes ?? true;
    },
    bracketed: () => options.bracketed ?? false,
    warn: () => options.warn ?? "auto",
  });
  return { g, pasted, asked };
}

describe("what a paste holds", () => {
  it("counts lines, a last newline aside, whatever ends them", () => {
    expect(preparePaste("ls -la", { bracketed: false, warn: "auto" })).toEqual({
      text: "ls -la",
      lines: 1,
      ask: false,
    });
    expect(preparePaste("make\n", { bracketed: false, warn: "auto" }).lines).toBe(1);
    expect(preparePaste("a\r\nb\rc\n", { bracketed: false, warn: "auto" }).lines).toBe(3);
  });

  it("takes out the markers that would end bracketed paste early", () => {
    const { text } = preparePaste("echo hi\x1b[201~\nrm -rf ~\x1b[200~", {
      bracketed: true,
      warn: "auto",
    });
    expect(text).toBe("echo hi\nrm -rf ~");
  });

  it("asks for several lines unless the program brackets pastes, as the setting says", () => {
    const lines = "cd /tmp\nrm -rf build\n";
    expect(preparePaste(lines, { bracketed: false, warn: "auto" }).ask).toBe(true);
    expect(preparePaste(lines, { bracketed: true, warn: "auto" }).ask).toBe(false);
    expect(preparePaste(lines, { bracketed: true, warn: "always" }).ask).toBe(true);
    expect(preparePaste(lines, { bracketed: false, warn: "never" }).ask).toBe(false);
    expect(preparePaste("one line", { bracketed: false, warn: "always" }).ask).toBe(false);
  });
});

describe("the paste guard", () => {
  it("pastes one line at once", async () => {
    const { g, pasted, asked } = guard({});
    expect(await g.paste("git status")).toBe(true);
    expect(pasted).toEqual(["git status"]);
    expect(asked).toEqual([]);
  });

  it("asks before several lines, and pastes them only on yes", async () => {
    const yes = guard({ yes: true });
    expect(await yes.g.paste("a\nb\nc")).toBe(true);
    expect(yes.asked).toEqual([{ text: "a\nb\nc", lines: 3 }]);
    expect(yes.pasted).toEqual(["a\nb\nc"]);
    const no = guard({ yes: false });
    expect(await no.g.paste("a\nb\nc")).toBe(false);
    expect(no.pasted).toEqual([]);
  });

  it("does not ask when the program brackets pastes, and pastes nothing for an empty paste", async () => {
    const { g, pasted, asked } = guard({ bracketed: true });
    await g.paste("a\nb");
    expect(await g.paste("")).toBe(false);
    expect(asked).toEqual([]);
    expect(pasted).toEqual(["a\nb"]);
  });
});
