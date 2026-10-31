import { Base, element, shadow } from "./base";
import { type Block, type Inline, parseBlocks } from "./markdown-parse";

const css = `
:host {
  display: block;
  color: var(--desk-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
}
:host([hidden]) {
  display: none;
}
h1,
h2,
h3,
h4,
h5,
h6 {
  margin: 12px 0 6px;
  color: var(--desk-text);
  font-size: 15px;
  line-height: 1.3;
}
h1 {
  font-size: 18px;
}
p,
ul,
ol,
pre,
blockquote {
  margin: 0 0 8px;
}
code {
  padding: 0 4px;
  border-radius: 4px;
  background: var(--desk-border);
  color: var(--desk-text);
  font-family: ui-monospace, monospace;
  font-size: 12px;
}
pre {
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--desk-border);
  overflow: auto;
}
pre code {
  padding: 0;
}
blockquote {
  padding-left: 10px;
  border-left: 2px solid var(--desk-border);
  color: var(--desk-text-muted);
}
a {
  color: var(--desk-accent);
  text-decoration: underline;
  cursor: pointer;
}
a:focus-visible {
  outline: 2px solid var(--desk-accent);
  outline-offset: 2px;
}
.alt {
  color: var(--desk-text-muted);
  font-style: italic;
}
:host([density="compact"]) {
  font-size: 12px;
  line-height: 1.4;
}
`;

/** What `desk-link` carries: the link's address, for the page to open (or not). */
export type DeskLinkDetail = { href: string };

/**
 * `<desk-markdown>`: its `source` (a property, or the attribute) as a small CommonMark subset:
 * headings, paragraphs, emphasis, strong, inline and fenced code, lists, quotes and links. It builds
 * nodes with `createElement` and `textContent` only: raw HTML stays text, images show their alt text
 * and load nothing, and links (http, https, mailto) carry no `href`, so the frame never navigates.
 * Enter or a click on one fires `desk-link` ({@link DeskLinkDetail}).
 */
export class DeskMarkdown extends Base {
  static readonly styles = css;
  static readonly observedAttributes = ["source"];
  readonly #body = element("div", { class: "body", part: "body" });
  readonly #hrefs = new WeakMap<Node, string>();
  #source = "";

  constructor() {
    super();
    shadow(this, css, [this.#body]);
    this.#body.addEventListener("click", (event) => this.#follow(event));
    this.#body.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.#follow(event);
    });
  }

  get source(): string {
    return this.#source;
  }

  set source(source: string) {
    this.#source = source;
    this.#body.replaceChildren(...parseBlocks(source).map((block) => this.#block(block)));
  }

  attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    this.source = value ?? "";
  }

  #block(block: Block): HTMLElement {
    switch (block.kind) {
      case "heading":
        return this.#with(`h${block.level}`, block.children);
      case "paragraph":
        return this.#with("p", block.children);
      case "code": {
        const pre = element("pre");
        const code = element("code");
        code.textContent = block.text;
        pre.append(code);
        return pre;
      }
      case "quote": {
        const quote = element("blockquote");
        quote.append(...block.blocks.map((inner) => this.#block(inner)));
        return quote;
      }
      case "list": {
        const list = element(block.ordered ? "ol" : "ul");
        list.append(...block.items.map((item) => this.#with("li", item)));
        return list;
      }
    }
  }

  #with(tag: string, children: Inline[]): HTMLElement {
    const node = element(tag);
    node.append(...children.map((child) => this.#inline(child)));
    return node;
  }

  #inline(inline: Inline): Node {
    switch (inline.kind) {
      case "text":
        return document.createTextNode(inline.text);
      case "em":
      case "strong":
        return this.#with(inline.kind, inline.children);
      case "code": {
        const code = element("code");
        code.textContent = inline.text;
        return code;
      }
      case "image": {
        const alt = element("span", { class: "alt" });
        alt.textContent = inline.alt;
        return alt;
      }
      case "link": {
        const link = this.#with("a", inline.children);
        link.setAttribute("role", "link");
        link.setAttribute("tabindex", "0");
        this.#hrefs.set(link, inline.href);
        return link;
      }
    }
  }

  #follow(event: Event): void {
    for (let at = event.target as Node | null; at && at !== this.#body; at = at.parentNode) {
      const href = this.#hrefs.get(at);
      if (href === undefined) continue;
      event.preventDefault();
      const detail: DeskLinkDetail = { href };
      this.dispatchEvent(new CustomEvent("desk-link", { bubbles: true, detail }));
      return;
    }
  }
}
