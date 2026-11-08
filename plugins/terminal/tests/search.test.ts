// Search in the scrollback (#538, TERM-E08): find next and previous, match case, regular
// expressions and whole words through xterm's search addon, the count of matches, and Mod+F (Control
// +Shift+F off macOS) opening it from inside the terminal.
import { describe, expect, it } from "vitest";
import { decide, type KeyPress } from "../ui/keys.js";
import { createSearch } from "../ui/search.js";

type Options = {
  caseSensitive?: boolean;
  regex?: boolean;
  wholeWord?: boolean;
  incremental?: boolean;
};

function addon() {
  const calls: Array<[string, string?, Options?]> = [];
  let results: ((e: { resultIndex: number; resultCount: number }) => void) | undefined;
  return {
    calls,
    findNext: (term: string, options?: Options) => {
      calls.push(["next", term, options]);
      return true;
    },
    findPrevious: (term: string, options?: Options) => {
      calls.push(["previous", term, options]);
      return true;
    },
    clearDecorations: () => calls.push(["clear"]),
    onDidChangeResults: (listener: typeof results) => {
      results = listener;
      return { dispose: () => {} };
    },
    results: (resultIndex: number, resultCount: number) => results?.({ resultIndex, resultCount }),
  };
}

const DECORATIONS = { matchOverviewRuler: "#888888", activeMatchColorOverviewRuler: "#ffffff" };

function searching() {
  const a = addon();
  const shown: string[] = [];
  const search = createSearch(a, {
    decorations: DECORATIONS,
    render: (state) => shown.push(state.label),
  });
  return { a, search, shown };
}

const exact = (o: Options) => ({
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  incremental: false,
  decorations: DECORATIONS,
  ...o,
});

describe("search in the scrollback", () => {
  it("finds next and previous, with match case, regex and whole word", () => {
    const { a, search } = searching();
    search.find("error", "next");
    search.find("error", "previous");
    search.set({ caseSensitive: true, wholeWord: true });
    search.find("Error", "next");
    search.set({ caseSensitive: false, wholeWord: false, regex: true });
    search.find("err(or)?s?", "previous");
    expect(a.calls).toEqual([
      ["next", "error", exact({})],
      ["previous", "error", exact({})],
      ["next", "Error", exact({ caseSensitive: true, wholeWord: true })],
      ["previous", "err(or)?s?", exact({ regex: true })],
    ]);
  });

  it("searches as the person types, from where the match is", () => {
    const { a, search } = searching();
    search.type("warn");
    expect(a.calls).toEqual([["next", "warn", exact({ incremental: true })]]);
  });

  it("an invalid regular expression is said, not searched", () => {
    const { a, search, shown } = searching();
    search.set({ regex: true });
    search.find("([a-z]", "next");
    expect(a.calls).toEqual([]);
    expect(search.state().error).toMatch(/^Not a regular expression/u);
    expect(shown.at(-1)).toMatch(/^Not a regular expression/u);
    search.find("[a-z]+", "next");
    expect(search.state().error).toBeNull();
    expect(a.calls).toHaveLength(1);
  });

  it("counts the matches: which one of how many, or none", () => {
    const { a, search, shown } = searching();
    search.find("ok", "next");
    a.results(2, 12);
    expect(shown.at(-1)).toBe("3 of 12");
    a.results(-1, 0);
    expect(shown.at(-1)).toBe("No results");
    a.results(-1, 7);
    expect(shown.at(-1)).toBe("7 matches");
  });

  it("an empty query or closing clears the highlights", () => {
    const { a, search, shown } = searching();
    search.find("x", "next");
    search.type("");
    search.close();
    expect(a.calls.slice(1)).toEqual([["clear"], ["clear"]]);
    expect(shown.at(-1)).toBe("");
  });
});

describe("the key that opens it", () => {
  const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...mods,
  });

  it("is Mod+F on macOS and Control+Shift+F elsewhere; Control+F stays the shell's", () => {
    expect(decide(press("f", { metaKey: true }), { platform: "mac" })).toBe("find");
    expect(decide(press("F", { ctrlKey: true, shiftKey: true }), { platform: "linux" })).toBe(
      "find",
    );
    expect(decide(press("F", { ctrlKey: true, shiftKey: true }), { platform: "windows" })).toBe(
      "find",
    );
    expect(decide(press("f", { ctrlKey: true }), { platform: "linux" })).toBe("terminal");
    expect(decide(press("f", { ctrlKey: true }), { platform: "mac" })).toBe("terminal");
  });
});
