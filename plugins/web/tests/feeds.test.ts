// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { preparePage } from "../ui/page.js";
import { utf8 } from "./build";

const nowhere = { read: async () => null };

async function entries(xml: string, path: string) {
  const model = await openFile(utf8(xml), path, nowhere);
  if (model.kind !== "entries") throw new Error(`not entries: ${JSON.stringify(model)}`);
  return model;
}

async function content(page: Parameters<typeof preparePage>[0] | undefined) {
  if (!page) throw new Error("the entry has no content");
  const prepared = await preparePage(page, document);
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).append(prepared.root);
  return host.shadowRoot as ShadowRoot;
}

const RSS2 = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Example news</title><link>https://example.com/</link><description>News</description>
<item><title>First &amp; best</title><link>https://example.com/1</link><pubDate>Fri, 30 Oct 2026 09:00:00 GMT</pubDate>
<dc:creator>Ada</dc:creator><description>Short</description>
<content:encoded><![CDATA[<p>Full <b>story</b></p><script>alert(1)</script><img src="https://example.com/x.png" onerror="alert(1)">]]></content:encoded></item>
<item><title>Second</title><author>editor@example.com (Grace)</author>
<description>&lt;p onclick="alert(1)"&gt;Escaped &lt;i&gt;HTML&lt;/i&gt;&lt;/p&gt;</description></item>
</channel></rss>`;

const RSS1 = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://example.org/"><title>RDF site</title><link>https://example.org/</link><description>d</description></channel>
<item rdf:about="https://example.org/a"><title>Entry A</title><link>https://example.org/a</link>
<dc:date>2026-10-29T08:00:00Z</dc:date><dc:creator>Lin</dc:creator><description>About A</description></item>
</rdf:RDF>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title type="text">Atom blog</title><updated>2026-10-28T00:00:00Z</updated>
<entry><title>HTML post</title><link rel="alternate" href="https://example.net/p1"/><id>urn:1</id>
<published>2026-10-28T10:00:00Z</published><updated>2026-10-28T11:00:00Z</updated><author><name>Kim</name></author>
<content type="html">&lt;p&gt;Hello &lt;a href="javascript:alert(1)"&gt;there&lt;/a&gt;&lt;/p&gt;</content></entry>
<entry><title type="html">&lt;b&gt;XHTML&lt;/b&gt; post</title><id>urn:2</id><updated>2026-10-27T00:00:00Z</updated>
<summary type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Inline <em>xhtml</em></p><script>alert(1)</script></div></summary></entry>
</feed>`;

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>My feeds</title></head><body>
<outline text="Tech"><outline text="Example" type="rss" xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com/"/>
<outline text="Other" xmlUrl="https://other.example/rss"/></outline>
<outline title="Loose" type="link" url="https://loose.example/"/>
</body></opml>`;

describe("feeds", () => {
  it("RSS 2.0: entries with title, date and author; content sanitized", async () => {
    const model = await entries(RSS2, "~/Feeds/news.rss");
    expect(model).toMatchObject({ format: "RSS feed", title: "Example news", selected: 0 });
    expect(model.entries.map(({ title, date, author }) => ({ title, date, author }))).toEqual([
      { title: "First & best", date: "2026-10-30T09:00:00.000Z", author: "Ada" },
      { title: "Second", date: undefined, author: "editor@example.com (Grace)" },
    ]);
    const first = await content(model.entries[0]?.page);
    expect(first.querySelector("p")?.textContent).toBe("Full story");
    expect(first.querySelector("script")).toBeNull();
    expect(first.querySelector("img")?.hasAttribute("onerror")).toBe(false);
    expect(first.querySelector("img")?.hasAttribute("src")).toBe(false);
    const second = await content(model.entries[1]?.page);
    expect(second.querySelector("p")?.textContent).toBe("Escaped HTML");
    expect(second.querySelector("p")?.hasAttribute("onclick")).toBe(false);
  });

  it("RSS 1.0 (RDF): items next to the channel, Dublin Core dates and creators", async () => {
    const model = await entries(RSS1, "~/Feeds/site.rdf.rss");
    expect(model).toMatchObject({ format: "RSS feed", title: "RDF site" });
    expect(model.entries).toMatchObject([
      {
        title: "Entry A",
        date: "2026-10-29T08:00:00.000Z",
        author: "Lin",
        link: "https://example.org/a",
      },
    ]);
    expect((await content(model.entries[0]?.page)).textContent).toContain("About A");
  });

  it("Atom: html and xhtml content, authors and dates", async () => {
    const model = await entries(ATOM, "~/Feeds/blog.atom");
    expect(model).toMatchObject({ format: "Atom feed", title: "Atom blog" });
    expect(
      model.entries.map(({ title, date, author, link }) => ({ title, date, author, link })),
    ).toEqual([
      {
        title: "HTML post",
        date: "2026-10-28T10:00:00.000Z",
        author: "Kim",
        link: "https://example.net/p1",
      },
      { title: "XHTML post", date: "2026-10-27T00:00:00.000Z", author: undefined, link: undefined },
    ]);
    const html = await content(model.entries[0]?.page);
    expect(html.querySelector("a")?.textContent).toBe("there");
    expect(html.querySelector("a")?.hasAttribute("href")).toBe(false);
    const xhtml = await content(model.entries[1]?.page);
    expect(xhtml.querySelector("em")?.textContent).toBe("xhtml");
    expect(xhtml.querySelector("script")).toBeNull();
  });

  it("OPML: a tree of outlines with their feed and page URLs", async () => {
    const model = await openFile(utf8(OPML), "~/Feeds/subs.opml", nowhere);
    expect(model).toMatchObject({
      kind: "outline",
      format: "OPML outline",
      title: "My feeds",
      outlines: [
        {
          text: "Tech",
          children: [
            {
              text: "Example",
              feed: "https://example.com/feed.xml",
              page: "https://example.com/",
              children: [],
            },
            { text: "Other", feed: "https://other.example/rss", children: [] },
          ],
        },
        { text: "Loose", page: "https://loose.example/", children: [] },
      ],
    });
  });

  it("a feed that is not well-formed XML opens as its details", async () => {
    const model = await openFile(
      utf8("<rss><channel><title>x</channel>"),
      "~/Feeds/bad.rss",
      nowhere,
    );
    expect(model).toMatchObject({ kind: "details", format: "RSS feed" });
  });
});
