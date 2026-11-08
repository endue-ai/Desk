// @vitest-environment jsdom
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { preparePage } from "../ui/page.js";
import { httpResponse, PNG, pngData, utf8, warcRecord, zip } from "./build";
import { fixture } from "./harness";

const nowhere = { read: async () => null };

async function drawn(page: Parameters<typeof preparePage>[0]) {
  const prepared = await preparePage(page, document);
  const host = document.createElement("div");
  host.attachShadow({ mode: "open" }).append(prepared.root);
  return { prepared, shadow: host.shadowRoot as ShadowRoot };
}

const MHTML = [
  "From: <Saved by Blink>",
  "Snapshot-Content-Location: https://example.com/cafe",
  "Subject: Cafe",
  "MIME-Version: 1.0",
  "Content-Type: multipart/related;",
  '\ttype="text/html";',
  '\tboundary="----MultipartBoundary--abc----"',
  "",
  "",
  "------MultipartBoundary--abc----",
  "Content-Type: text/html; charset=utf-8",
  "Content-ID: <frame-1@mhtml.blink>",
  "Content-Transfer-Encoding: quoted-printable",
  "Content-Location: https://example.com/cafe",
  "",
  '<html><head><title>Caf=C3=A9</title><link rel=3D"stylesheet" href=3D"https://example.com/s.c=',
  'ss"></head><body><p class=3D"menu">Caf=C3=A9 au lait, =EC=BB=A4=ED=94=BC</p><img src=3D"dot.png">=',
  '<img src=3D"cid:img-2@mhtml.blink" alt=3D"by id"><img src=3D"https://example.org/elsewhere.png"></body></html>',
  "------MultipartBoundary--abc----",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-Location: https://example.com/dot.png",
  "",
  PNG.toString("base64").replace(/(.{20})/g, "$1\r\n"),
  "------MultipartBoundary--abc----",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  "Content-ID: <img-2@mhtml.blink>",
  "",
  PNG.toString("base64"),
  "------MultipartBoundary--abc----",
  "Content-Type: text/css",
  "Content-Transfer-Encoding: quoted-printable",
  "Content-Location: https://example.com/s.css",
  "",
  ".menu { color: rgb(1, 2, 3) }",
  "------MultipartBoundary--abc------",
  "",
].join("\r\n");

const PAGE_HTML =
  '<html><head><title>Crawled</title></head><body><p>From the crawl</p><img src="/logo.png"></body></html>';
const records = (version: string) => [
  warcRecord(
    version,
    {
      "WARC-Type": "warcinfo",
      "WARC-Date": "2026-10-30T09:00:00Z",
      "Content-Type": "application/warc-fields",
    },
    utf8("software: test\r\n"),
  ),
  warcRecord(
    version,
    {
      "WARC-Type": "request",
      "WARC-Target-URI": "https://example.com/",
      "Content-Type": "application/http; msgtype=request",
    },
    utf8("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"),
  ),
  warcRecord(
    version,
    {
      "WARC-Type": "response",
      "WARC-Target-URI": version === "1.0" ? "<https://example.com/>" : "https://example.com/",
      "WARC-Date": "2026-10-30T09:00:01Z",
      "Content-Type": "application/http; msgtype=response",
    },
    httpResponse("text/html; charset=utf-8", utf8(PAGE_HTML)),
  ),
  warcRecord(
    version,
    {
      "WARC-Type": "response",
      "WARC-Target-URI": "https://example.com/logo.png",
      "Content-Type": "application/http; msgtype=response",
    },
    httpResponse("image/png", gzipSync(PNG), "Content-Encoding: gzip\r\n"),
  ),
];

describe("web archives", () => {
  it("MHTML: quoted-printable HTML with its charset, parts by Content-Location and Content-ID", async () => {
    const model = await openFile(utf8(MHTML), "~/Saved/cafe.mhtml", nowhere);
    expect(model).toMatchObject({ kind: "page", format: "MHTML archive" });
    if (model.kind !== "page") return;
    expect(model.source).toContain("Café au lait, 커피");
    const { prepared, shadow } = await drawn(model.page);
    expect(prepared.title).toBe("Café");
    expect(shadow.querySelector("p")?.textContent).toBe("Café au lait, 커피");
    const srcs = [...shadow.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(srcs).toEqual([pngData, pngData, null]);
    const css = [...shadow.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain(".menu { color: rgb(1, 2, 3) }");
    expect(prepared.left).toEqual({ remote: 1, missing: 0, limit: 0 });
  });

  it("a binary .webarchive: the main resource and its subresources by URL", async () => {
    const model = await openFile(fixture("page.webarchive"), "~/Saved/page.webarchive", nowhere);
    expect(model).toMatchObject({ kind: "page", format: "Safari web archive" });
    if (model.kind !== "page") return;
    const { prepared, shadow } = await drawn(model.page);
    expect(prepared.title).toBe("Archived page");
    expect(shadow.querySelector("p")?.textContent).toBe("Café and 한국어");
    expect(shadow.querySelector("img[alt=dot]")?.getAttribute("src")).toBe(pngData);
    expect(shadow.querySelector("img[alt=remote]")?.hasAttribute("src")).toBe(false);
    const css = [...shadow.querySelectorAll("style")].map((s) => s.textContent).join("\n");
    expect(css).toContain("h1 { color: rgb(10, 20, 30); }");
    expect(prepared.left).toEqual({ remote: 1, missing: 0, limit: 0 });
  });

  it("a .webarchive written by textutil, a real Apple tool", async () => {
    const model = await openFile(fixture("textutil.webarchive"), "~/Saved/t.webarchive", nowhere);
    if (model.kind !== "page") throw new Error(model.kind);
    const { shadow } = await drawn(model.page);
    expect(shadow.textContent).toContain("Converted page");
    expect(shadow.textContent).toContain("A paragraph with bold text.");
  });

  for (const version of ["1.0", "1.1"])
    it(`WARC ${version}: records listed, the HTML response drawn with the other response`, async () => {
      const bytes = new Uint8Array(Buffer.concat(records(version)));
      const model = await openFile(bytes, "~/Saved/crawl.warc", nowhere);
      expect(model).toMatchObject({ kind: "entries", format: "WARC archive", selected: 2 });
      if (model.kind !== "entries") return;
      expect(model.entries.map((e) => [e.title, e.detail])).toEqual([
        ["warcinfo", "warcinfo · application/warc-fields"],
        ["https://example.com/", "request · application/http"],
        ["https://example.com/", "response · text/html"],
        ["https://example.com/logo.png", "response · image/png"],
      ]);
      const page = model.entries[2]?.page;
      if (!page) throw new Error("the HTML response has no page");
      const { shadow } = await drawn(page);
      expect(shadow.querySelector("p")?.textContent).toBe("From the crawl");
      expect(shadow.querySelector("img")?.getAttribute("src")).toBe(pngData);
      expect(model.entries[3]?.text).toContain("Content-Type: image/png");
    });

  it("a .warc.gz with one gzip member per record", async () => {
    const members = records("1.1").map((record) => gzipSync(record));
    const bytes = new Uint8Array(Buffer.concat(members));
    const model = await openFile(bytes, "~/Saved/crawl.warc.gz", nowhere);
    expect(model).toMatchObject({ kind: "entries", format: "Compressed WARC archive" });
    if (model.kind !== "entries") return;
    expect(model.entries).toHaveLength(4);
    const page = model.entries[2]?.page;
    if (!page) throw new Error("the HTML response has no page");
    const { shadow } = await drawn(page);
    expect(shadow.querySelector("img")?.getAttribute("src")).toBe(pngData);
  });

  it("MAFF: one page per folder, resources inside the archive", async () => {
    const rdf = `<?xml version="1.0"?><RDF:RDF xmlns:MAF="http://maf.mozdev.org/metadata/rdf#"
      xmlns:RDF="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><RDF:Description RDF:about="urn:root">
      <MAF:originalurl RDF:resource="https://example.com/first"/><MAF:title RDF:resource="First page"/>
      <MAF:indexfilename RDF:resource="index.htm"/></RDF:Description></RDF:RDF>`;
    const bytes = zip(
      {
        "1572000000_123/index.rdf": rdf,
        "1572000000_123/index.htm":
          '<p>First</p><img src="index_files/dot.png"><a href="../1572000001_456/index.html">next</a>',
        "1572000000_123/index_files/dot.png": PNG,
        "1572000001_456/index.html": "<title>Second</title><p>Second</p>",
      },
      ["1572000000_123/index_files/dot.png"],
    );
    const model = await openFile(bytes, "~/Saved/pages.maff", nowhere);
    expect(model).toMatchObject({ kind: "entries", format: "MAFF archive", selected: 0 });
    if (model.kind !== "entries") return;
    expect(model.entries.map((e) => [e.title, e.detail])).toEqual([
      ["First page", "https://example.com/first"],
      ["1572000001_456", "index.html"],
    ]);
    const first = model.entries[0]?.page;
    if (!first) throw new Error("no first page");
    const { shadow } = await drawn(first);
    expect(shadow.querySelector("p")?.textContent).toBe("First");
    expect(shadow.querySelector("img")?.getAttribute("src")).toBe(pngData);
  });
});
