// @vitest-environment jsdom
// A PL/pgSQL body in the console editor (PG-35, ADR 0343): inside its dollar quotes PL/pgSQL's
// keywords and SQL's, declared variables and parameters, strings, numbers and comments are drawn as
// such, a body in another language stays one string, and the lines of BEGIN, IF, LOOP and CASE fold
// to their END. Read from the editor's own token cache (tokens.js), then in the editor on jsdom.
import { beforeAll, describe, expect, it } from "vitest";
import { runsOf } from "../ui/editor/highlight.js";
import { foldsIn } from "../ui/editor/pairs.js";
import { withBodies } from "../ui/editor/plpgsql.js";
import { Lexed } from "../ui/editor/tokens.js";
import { EditorView } from "../ui/vendor/editor/editor-component.mjs";
import { createEditor } from "../ui/view-editor.js";

const source = (text: string) => ({
  length: text.length,
  sliceString: (from: number, to = text.length) => text.slice(from, to),
});

/** Each non-plain span of `text` as [its text, its kind]. */
function drawn(text: string) {
  const lexed = new Lexed("postgresql", source(text));
  const { tokens } = lexed.tokens(0, text.length);
  const spans = withBodies(
    lexed,
    tokens,
    runsOf(tokens, "postgresql", 0, text.length),
    0,
    text.length,
  );
  return spans.map((s) => [text.slice(s.from, s.to), s.kind]);
}

const ROUTINE = [
  "create function f(a int, b text) returns int language plpgsql as $$",
  "declare",
  "  total int := 0; -- running",
  "begin",
  "  if a > 0 then",
  "    select count(*) into total from people where name = b;",
  "  end if;",
  "  raise notice 'got %', $1;",
  "  return total;",
  "end",
  "$$;",
].join("\n");

describe("a PL/pgSQL body's tokens", () => {
  it("draws keywords, variables, parameters, strings, numbers and comments inside the dollar quotes", () => {
    const spans = drawn(ROUTINE);
    const kinds = (word: string) => spans.filter(([t]) => t === word).map(([, k]) => k);
    for (const word of [
      "declare",
      "begin",
      "if",
      "then",
      "select",
      "into",
      "from",
      "where",
      "raise",
      "notice",
      "return",
      "end",
    ])
      expect([word, kinds(word)[0]]).toEqual([word, "keyword"]);
    expect(kinds("total")).toEqual(["variable", "variable", "variable"]);
    expect(kinds("a")).toEqual(["variable"]);
    expect(kinds("b")).toEqual(["variable"]);
    expect(kinds("count")).toEqual(["function"]);
    expect(kinds("'got %'")).toEqual(["string"]);
    expect(kinds("0")).toEqual(["number", "number"]);
    expect(kinds("-- running")).toEqual(["comment"]);
    expect(kinds("$1")).toEqual(["param"]);
    // The quotes themselves stay a string; nothing inside is one string any more.
    expect(spans.filter(([, k]) => k === "string").map(([t]) => t)).toEqual([
      "$$",
      "'got %'",
      "$$",
    ]);
    expect(kinds("people")).toEqual([]);
  });

  it("leaves another language's body, and a dollar string that is no body, one string", () => {
    const sql =
      "create function g() returns int language sql as $$ select 1 $$;\nselect $$ begin end $$;";
    expect(drawn(sql).filter(([, k]) => k === "string")).toEqual([
      ["$$ select 1 $$", "string"],
      ["$$ begin end $$", "string"],
    ]);
  });

  it("is drawn the same from a checkpoint in the middle of a long script", () => {
    const filler = "select 1;\n".repeat(4000);
    const text = filler + ROUTINE;
    const lexed = new Lexed("postgresql", source(text));
    lexed.work(() => false);
    const from = text.indexOf("  raise");
    const to = text.length;
    const { tokens } = lexed.tokens(from, to);
    const spans = withBodies(lexed, tokens, runsOf(tokens, "postgresql", from, to), from, to);
    const words = spans.map((s) => [text.slice(s.from, s.to), s.kind]);
    expect(words).toContainEqual(["raise", "keyword"]);
    expect(words).toContainEqual(["total", "variable"]);
  });
});

describe("a PL/pgSQL body's folds", () => {
  it("folds BEGIN, IF, LOOP and CASE to their END", () => {
    const text = [
      "do $$",
      "begin",
      "  loop",
      "    exit;",
      "  end loop;",
      "  case 1",
      "    when 1 then null;",
      "  end case;",
      "  if true then",
      "    null;",
      "  end if;",
      "end",
      "$$;",
    ].join("\n");
    const lexed = new Lexed("postgresql", source(text));
    const folds = foldsIn(lexed, 0, text.length);
    const at = (line: string) => folds.get(text.indexOf(line));
    const folded = (line: string) => {
      const range = at(line);
      return range ? text.slice(range.to, range.to + 8) : null;
    };
    expect(folded("begin")).toBe("end\n$$;");
    expect(folded("  loop")).toBe("end loop");
    expect(folded("  case 1")).toBe("end case");
    expect(folded("  if true")).toBe("end if;\n");
    // The statement's own fold, from its first line, stays.
    expect(folds.get(0)).toBeDefined();
    // DECLARE folds to BEGIN, and BEGIN to its END.
    const declared = "do $$\ndeclare\n  x int;\nbegin\n  x := 1;\nend\n$$;";
    const more = foldsIn(new Lexed("postgresql", source(declared)), 0, declared.length);
    const range = (line: string) => more.get(declared.indexOf(line));
    expect(declared.slice(range("declare")?.to ?? 0, (range("declare")?.to ?? 0) + 5)).toBe(
      "begin",
    );
    expect(declared.slice(range("begin")?.to ?? 0, (range("begin")?.to ?? 0) + 3)).toBe("end");
  });
});

describe("in the console editor", () => {
  beforeAll(() => {
    const none = () => Object.assign([], { item: () => null });
    Range.prototype.getClientRects = none as never;
    Range.prototype.getBoundingClientRect = () => new DOMRect();
  });

  it("marks a body's variables and keywords with their classes", () => {
    document.body.innerHTML =
      '<div id="editor-box"><pre id="highlight"></pre><textarea id="editor" aria-label="SQL"></textarea><ul id="complete" hidden></ul></div>';
    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    const box = byId("editor-box");
    const ed = createEditor(
      document,
      {
        box,
        editor: byId("editor") as HTMLTextAreaElement,
        layer: byId("highlight"),
        list: byId("complete"),
      },
      () => undefined,
      () => false,
    );
    ed.show(ROUTINE, "postgresql", false, "first");
    const view = EditorView.findFromDOM(box.querySelector(".cm-editor") as HTMLElement);
    expect(view).toBeTruthy();
    const texts = (cls: string) => [...box.querySelectorAll(`.${cls}`)].map((e) => e.textContent);
    expect(texts("tok-variable")).toContain("total");
    expect(texts("tok-keyword")).toContain("raise");
    expect(texts("tok-string")).not.toContain("$$\ndeclare");
  });
});
