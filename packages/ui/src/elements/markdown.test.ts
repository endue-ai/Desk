import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { press, queryAll, reset } from "./test-dom";

defineElements();

function markdown(source: string) {
  const element = document.createElement("desk-markdown");
  element.source = source;
  document.body.append(element);
  const root = element.shadowRoot as unknown as Element;
  const all = () => queryAll(root, () => true);
  const tags = (name: string) => queryAll(root, (el) => el.localName === name);
  return { element, root, all, tags };
}

/** The element tree under the shadow root, without its own style sheet: tag names and text. */
function shape(el: Element): unknown {
  const kids = [...el.children].filter((child) => child.localName !== "style");
  if (kids.length === 0) return `${el.localName}: ${el.textContent}`;
  return { [el.localName]: kids.map(shape) };
}

describe("desk-markdown", () => {
  beforeEach(reset);

  it("renders headings, paragraphs, emphasis, code, lists and quotes", () => {
    const { root } = markdown(
      [
        "# Ideas",
        "",
        "A *quick* list, **in bold**, with `code`.",
        "",
        "- One",
        "- Two",
        "",
        "1. First",
        "2. Second",
        "",
        "> Said once",
        "",
        "```",
        "let x = 1;",
        "```",
        "",
        "## Next",
      ].join("\n"),
    );
    const [body] = queryAll(root, (el) => el.getAttribute("class") === "body");
    expect(shape(body as Element)).toEqual({
      div: [
        "h1: Ideas",
        { p: ["em: quick", "strong: in bold", "code: code"] },
        { ul: ["li: One", "li: Two"] },
        { ol: ["li: First", "li: Second"] },
        { blockquote: ["p: Said once"] },
        { pre: ["code: let x = 1;"] },
        "h2: Next",
      ],
    });
    const [paragraph] = queryAll(root, (el) => el.localName === "p");
    expect(paragraph?.textContent).toBe("A quick list, in bold, with code.");
  });

  it("keeps no script, handler, style or raw HTML", () => {
    const source = [
      "<script>alert(1)</script>",
      "",
      '<img src="x" onerror="alert(2)">',
      "",
      '<style>body { color: red }</style> and <iframe src="https://example.com"></iframe>',
    ].join("\n");
    const { root, all, tags } = markdown(source);
    expect(tags("script")).toEqual([]);
    expect(tags("img")).toEqual([]);
    expect(tags("iframe")).toEqual([]);
    // Its own style sheet is the only style element.
    expect(tags("style")).toHaveLength(1);
    for (const el of all()) {
      const names = ["style", "src", "href", "onerror", "onclick", "onload"];
      for (const name of names)
        expect(el.hasAttribute(name), `${el.localName} ${name}`).toBe(false);
    }
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.textContent).toContain('<img src="x" onerror="alert(2)">');
    expect(root.textContent).toContain('<iframe src="https://example.com"></iframe>');
  });

  it("draws images as their alt text and loads nothing", () => {
    const { tags, all } = markdown("Look: ![A red bicycle](https://example.com/bike.png)");
    expect(tags("img")).toEqual([]);
    const [alt] = all().filter((el) => el.getAttribute("class") === "alt");
    expect(alt?.textContent).toBe("A red bicycle");
    expect(
      all().some((el) => el.textContent?.includes("bike.png") && el.children.length === 0),
    ).toBe(false);
  });

  it("links do not navigate; activating one fires desk-link with its href", () => {
    const { element, tags, all } = markdown(
      "See [the docs](https://endue.ai/docs), [mail](mailto:team@endue.ai), " +
        "[bad](javascript:alert(1)) and [data](data:text/html,hi).",
    );
    const onLink = vi.fn();
    element.addEventListener("desk-link", onLink);
    const links = all().filter((el) => el.getAttribute("role") === "link");
    expect(links.map((link) => link.textContent)).toEqual(["the docs", "mail"]);
    expect(tags("a").every((a) => !a.hasAttribute("href"))).toBe(true);
    for (const link of links) expect(link.tabIndex).toBe(0);

    links[0]?.click();
    expect(onLink.mock.calls[0]?.[0].detail).toEqual({ href: "https://endue.ai/docs" });
    links[1]?.focus();
    expect(press("Enter")).toBe(true);
    expect(onLink.mock.calls[1]?.[0].detail).toEqual({ href: "mailto:team@endue.ai" });
    expect(onLink).toHaveBeenCalledTimes(2);

    const [paragraph] = tags("p");
    expect(paragraph?.textContent).toContain("bad");
    expect(paragraph?.textContent).toContain("data");
  });
});
