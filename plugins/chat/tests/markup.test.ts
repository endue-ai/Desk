import { describe, expect, it } from "vitest";
import { emojiOf, quickReactions, reactionLabel, sameEmoji } from "../ui/emoji.js";
import { inline, parse, plain, safeHref } from "../ui/markup.js";

const text = (v: string) => ({ t: "text", v });

describe("inline marks", () => {
  it("Markdown: bold, italic, strike and code, nested", () => {
    expect(inline("**bold** *it* _it_ ~~gone~~ `x*y*`")).toEqual([
      { t: "strong", c: [text("bold")] },
      text(" "),
      { t: "em", c: [text("it")] },
      text(" "),
      { t: "em", c: [text("it")] },
      text(" "),
      { t: "del", c: [text("gone")] },
      text(" "),
      { t: "code", v: "x*y*" },
    ]);
    expect(inline("*a **b** c*")).toEqual([
      { t: "em", c: [text("a "), { t: "strong", c: [text("b")] }, text(" c")] },
    ]);
  });

  it("Slack: *bold*, _italic_, ~strike~ and its escapes", () => {
    expect(inline("*10* _soon_ ~no~ a &lt;b&gt; &amp; c", "slack")).toEqual([
      { t: "strong", c: [text("10")] },
      text(" "),
      { t: "em", c: [text("soon")] },
      text(" "),
      { t: "del", c: [text("no")] },
      text(" a <b> & c"),
    ]);
  });

  it("leaves what is not a mark as text: snake_case, a lone star, 2 * 3 * 4", () => {
    expect(inline("snake_case_name")).toEqual([text("snake_case_name")]);
    expect(inline("2 * 3 * 4")).toEqual([text("2 * 3 * 4")]);
    expect(inline("**unclosed")).toEqual([text("**unclosed")]);
    expect(inline("price:100:")).toEqual([text("price:100:")]);
  });

  it("links: bare, Slack's <url|label>, Markdown's [label](url); punctuation stays outside", () => {
    expect(inline("see https://a.test/x, then")).toEqual([
      text("see "),
      { t: "link", href: "https://a.test/x", c: [text("https://a.test/x")] },
      text(", then"),
    ]);
    expect(inline("<https://ci.test/1|build 1>")).toEqual([
      { t: "link", href: "https://ci.test/1", c: [text("build 1")] },
    ]);
    expect(inline("[docs](https://d.test) and (https://p.test)")).toEqual([
      { t: "link", href: "https://d.test", c: [text("docs")] },
      text(" and ("),
      { t: "link", href: "https://p.test", c: [text("https://p.test")] },
      text(")"),
    ]);
    expect(inline("<mailto:a@b.test|a@b.test>")[0]).toMatchObject({ href: "mailto:a@b.test" });
  });

  it("never links a scheme other than http, https and mailto", () => {
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,x")).toBeUndefined();
    expect(safeHref("file:///etc/passwd")).toBeUndefined();
    expect(inline("[x](javascript:alert(1))")).toEqual([text("[x](javascript:alert(1))")]);
    expect(inline("<javascript:alert(1)|x>")).toEqual([text("<javascript:alert(1)|x>")]);
  });

  it("mentions, broad mentions, channels and emoji", () => {
    expect(inline("@mina. <@U1|jun> <!here> #general <#C2|design> :tada: <:pepe:123>")).toEqual([
      { t: "mention", v: "mina", broad: false },
      text(". "),
      { t: "mention", v: "jun", broad: false },
      text(" "),
      { t: "mention", v: "here", broad: true },
      text(" "),
      { t: "channel", v: "general" },
      text(" "),
      { t: "channel", v: "design" },
      text(" "),
      { t: "emoji", v: "🎉", name: "tada" },
      text(" "),
      { t: "emoji", v: ":pepe:", name: "pepe" },
    ]);
    expect(inline("mail me@example.com #1")).toEqual([text("mail me@example.com #1")]);
  });
});

describe("blocks", () => {
  it("paragraphs keep their line breaks; a blank line splits them", () => {
    expect(parse("one\ntwo\n\nthree")).toEqual([
      { t: "p", c: [text("one"), { t: "br" }, text("two")] },
      { t: "p", c: [text("three")] },
    ]);
  });

  it("quotes and fenced code, with or without a language, closed or not", () => {
    expect(parse("> said\n> twice\nreply")).toEqual([
      { t: "quote", c: [text("said"), { t: "br" }, text("twice")] },
      { t: "p", c: [text("reply")] },
    ]);
    expect(parse("```js\nlet a = *1*;\n```\nafter")).toEqual([
      { t: "pre", v: "let a = *1*;", lang: "js" },
      { t: "p", c: [text("after")] },
    ]);
    expect(parse("```inline``` tail")).toEqual([
      { t: "pre", v: "inline" },
      { t: "p", c: [text("tail")] },
    ]);
    expect(parse("```\nopen")).toEqual([{ t: "pre", v: "open" }]);
    expect(parse("Look: ```\nnpm test\n```")).toEqual([
      { t: "p", c: [text("Look:")] },
      { t: "pre", v: "npm test" },
    ]);
    expect(parse("a stray ```")).toEqual([{ t: "p", c: [text("a stray")] }]);
    expect(parse("use ```x = 1``` here")).toEqual([
      { t: "p", c: [text("use "), { t: "code", v: "x = 1" }, text(" here")] },
    ]);
    expect(parse("&gt; slack quote", "slack")).toEqual([{ t: "quote", c: [text("slack quote")] }]);
  });

  it("reads aloud without marks", () => {
    const [first] = parse("**hi** @mina :tada:");
    expect(first && "c" in first ? plain(first.c) : "").toBe("hi @mina 🎉");
  });
});

describe("emoji", () => {
  it("names become Unicode; unknown names stay; aliases are the same reaction", () => {
    expect(emojiOf(":tada:")).toBe("🎉");
    expect(emojiOf(":made_up:")).toBe(":made_up:");
    expect(sameEmoji(":+1:", "👍")).toBe(true);
    expect(sameEmoji(":thumbsup:", ":+1:")).toBe(true);
    expect(reactionLabel({ emoji: ":fire:", count: 3, self: true })).toBe("🔥 3, including you");
    expect(reactionLabel({ emoji: "👍", count: 1, self: false })).toBe("👍 1");
  });

  it("quick reactions come from the setting, six at most, else the defaults", () => {
    expect(quickReactions([":tada:", "🚀", "", 3])).toEqual(["🎉", "🚀"]);
    expect(quickReactions("nope")).toHaveLength(6);
    expect(quickReactions(Array.from({ length: 9 }, () => "👍"))).toHaveLength(6);
  });
});
