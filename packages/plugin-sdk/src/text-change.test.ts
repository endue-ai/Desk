// An unsaved text edit kept as one splice from the saved text (ADR XXXX): small enough for the 64 KiB
// the desk keeps across a sleep, and applied only to the text it was made from.
import { describe, expect, it } from "vitest";
import { applyTextChange, isTextChange, textChange, textSum } from "./text-change";

const roundTrip = (saved: string, text: string) =>
  applyTextChange(saved, JSON.parse(JSON.stringify(textChange(saved, text))));

describe("textChange", () => {
  it("is the splice between what both texts share at their ends", () => {
    expect(textChange("hello world", "hello brave world")).toMatchObject({
      from: 6,
      to: 6,
      put: "brave ",
      size: 11,
    });
    expect(textChange("abcdef", "abef")).toMatchObject({ from: 2, to: 4, put: "" });
    expect(textChange("abc", "xyz")).toMatchObject({ from: 0, to: 3, put: "xyz" });
    expect(textChange("same", "same")).toMatchObject({ from: 4, to: 4, put: "" });
  });

  it("gives the edited text back from the saved one, after JSON", () => {
    const pairs: Array<[string, string]> = [
      ["hello world", "hello brave world"],
      ["abcdef", "abef"],
      ["", "a new note\n"],
      ["all of it\n", ""],
      ["aaaa", "aaaaaa"],
      ["abab", "ab"],
      ["line\r\nline\r\n", "line\r\nnew\r\nline\r\n"],
    ];
    for (const [saved, text] of pairs) expect(roundTrip(saved, text)).toBe(text);
  });

  it("never cuts a surrogate pair, so what it puts is whole characters", () => {
    const change = textChange("a😀b", "a😃b");
    expect(change.put).toBe("😃");
    expect(roundTrip("a😀b", "a😃b")).toBe("a😃b");
    expect(textChange("x😀", "x😀😀").put).toBe("😀");
    expect(roundTrip("😀x", "😃x")).toBe("😃x");
  });

  it("keeps typing in a large note to a few bytes", () => {
    const saved = `# Long\n\n${"the desk keeps what a person was doing\n".repeat(3000)}`;
    const at = saved.length / 2;
    const text = `${saved.slice(0, at)} UNSAVED-EDIT${saved.slice(at)}`;
    expect(saved.length).toBeGreaterThan(100_000);
    expect(JSON.stringify(textChange(saved, text)).length).toBeLessThan(120);
    expect(roundTrip(saved, text)).toBe(text);
  });

  it("round-trips random edits", () => {
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const letters = "ab\n😀é ";
    const word = (n: number) =>
      Array.from({ length: n }, () => letters[random(letters.length)]).join("");
    for (let i = 0; i < 300; i++) {
      const saved = word(random(40));
      const from = random(saved.length + 1);
      const to = from + random(saved.length - from + 1);
      const text = saved.slice(0, from) + word(random(6)) + saved.slice(to);
      expect(roundTrip(saved, text)).toBe(text);
    }
  });
});

describe("applyTextChange", () => {
  it("refuses a text the change was not made from: the file changed meanwhile", () => {
    const change = textChange("version one\n", "version one, edited\n");
    expect(applyTextChange("version one\n", change)).toBe("version one, edited\n");
    expect(applyTextChange("version two\n", change)).toBeUndefined();
    expect(applyTextChange("version one\n\n", change)).toBeUndefined();
  });

  it("refuses what does not read as a change", () => {
    expect(applyTextChange("abc", null)).toBeUndefined();
    expect(applyTextChange("abc", { from: 2, to: 1, put: "", size: 3, sum: textSum("abc") })).toBe(
      undefined,
    );
    expect(applyTextChange("abc", { from: 0, to: 9, put: "", size: 3, sum: textSum("abc") })).toBe(
      undefined,
    );
    expect(isTextChange({ from: 0, to: 0, put: 1, size: 0, sum: "" })).toBe(false);
  });

  it("tells texts apart by their sum", () => {
    expect(textSum("abc")).toMatch(/^[0-9a-f]{16}$/);
    expect(textSum("abc")).not.toBe(textSum("acb"));
    expect(textSum("")).not.toBe(textSum("\0"));
  });
});
