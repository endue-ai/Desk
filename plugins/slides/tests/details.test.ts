// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { openFile } from "../ui/open.js";
import { createView } from "../ui/view.js";
import { cfb } from "./cfb";
import { loadPage } from "./page";
import { PNG } from "./pptx";
import { zip } from "./zip";

/** The smallest JPEG header: enough to be a JPEG for a sniffing reader. */
const JPEG = Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9,
]);

const show = (name: string, bytes: Uint8Array, opened: Awaited<ReturnType<typeof openFile>>) => {
  const view = createView(document);
  view.show({ buffer: `file:~/${name}`, path: `~/${name}`, name, size: bytes.length, opened });
  return document.querySelector<HTMLElement>("#details");
};

describe("files it cannot show as slides", () => {
  beforeEach(() => {
    loadPage();
  });

  it("a damaged file opens as the details view with its name, size, format and why", async () => {
    const bytes = new TextEncoder().encode("PK\u0003\u0004 this is not a zip at all");
    const opened = await openFile(bytes, "broken.pptx");
    expect(opened).toMatchObject({ kind: "details", format: "ZIP archive" });
    if (opened.kind !== "details") return;
    expect(opened.reason).toMatch(/damaged/);
    const details = show("broken.pptx", bytes, opened);
    expect(details?.hidden).toBe(false);
    expect(details?.textContent).toContain("broken.pptx");
    expect(details?.textContent).toContain(`${bytes.length} bytes`);
    expect(details?.textContent).toContain("ZIP archive");
    expect(details?.textContent).toContain(opened.reason);
    expect(document.querySelector<HTMLElement>("#deck")?.hidden).toBe(true);
  });

  it("a ZIP that is no presentation, and an empty file, say so", async () => {
    const other = await openFile(zip({ "readme.txt": "hello" }), "x.pptx");
    expect(other).toMatchObject({
      kind: "details",
      reason: "This ZIP archive holds no presentation.",
    });
    const empty = await openFile(new Uint8Array(), "empty.odp");
    expect(empty).toMatchObject({ kind: "details", reason: "The file is empty." });
  });

  it("a password-protected PowerPoint file opens as the details view", async () => {
    const bytes = cfb({
      EncryptionInfo: new Uint8Array(200),
      EncryptedPackage: new Uint8Array(5000),
    });
    const opened = await openFile(bytes, "secret.pptx");
    expect(opened).toMatchObject({
      kind: "details",
      format: "Encrypted Office document",
      reason: "This presentation is encrypted.",
    });
    expect(show("secret.pptx", bytes, opened)?.textContent).toContain(
      "This presentation is encrypted.",
    );
  });

  it("a password-protected ODF presentation opens as the details view", async () => {
    const manifest = `<?xml version="1.0"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1"/></manifest:file-entry></manifest:manifest>`;
    const bytes = zip({
      mimetype: "application/vnd.oasis.opendocument.presentation",
      "META-INF/manifest.xml": manifest,
      "content.xml": { data: new Uint8Array(40), stored: true },
    });
    expect(await openFile(bytes, "secret.odp")).toMatchObject({
      kind: "details",
      reason: "This presentation is encrypted.",
    });
  });

  it("a Keynote package shows its preview image", async () => {
    const bytes = zip({
      "Index/Document.iwa": new Uint8Array(32),
      "Metadata/Properties.plist": "<plist/>",
      "preview-micro.jpg": JPEG,
      "preview.jpg": JPEG,
      "Data/st-1.png": PNG,
    });
    const opened = await openFile(bytes, "talk.key");
    expect(opened).toMatchObject({
      kind: "preview",
      format: "Keynote presentation",
      sentence: "Keynote presentations show their preview image.",
    });
    if (opened.kind !== "preview") return;
    expect(opened.images[0]).toMatch(/^data:image\/jpeg;base64,\/9j\//);
    const details = show("talk.key", bytes, opened);
    expect(details?.textContent).toContain("Keynote presentations show their preview image.");
    expect(details?.querySelector("img")?.getAttribute("src")).toBe(opened.images[0]);
    expect(details?.querySelector("img")?.getAttribute("alt")).toBe("Preview of talk.key");
  });

  it("a Keynote package without a preview says why", async () => {
    const opened = await openFile(zip({ "Index/Document.iwa": new Uint8Array(32) }), "bare.key");
    expect(opened).toMatchObject({ kind: "details", format: "Keynote presentation" });
  });

  it("a Google Slides shortcut is a card with its URL as selectable text", async () => {
    const url = "https://docs.google.com/presentation/d/abc123/edit";
    const bytes = new TextEncoder().encode(JSON.stringify({ url, doc_id: "abc123" }));
    const opened = await openFile(bytes, "Plan.gslides");
    expect(opened).toMatchObject({ kind: "card", format: "Google Slides shortcut", url });
    const details = show("Plan.gslides", bytes, opened);
    expect(details?.textContent).toContain("Google Drive");
    const shownUrl = details?.querySelector(".url");
    expect(shownUrl?.textContent).toBe(url);
    expect(details?.querySelector("a")).toBeNull();

    const byId = await openFile(
      new TextEncoder().encode(JSON.stringify({ doc_id: "xyz" })),
      "b.gslides",
    );
    expect(byId).toMatchObject({
      kind: "card",
      url: "https://docs.google.com/presentation/d/xyz/edit",
    });
    const broken = await openFile(new TextEncoder().encode("{not json"), "c.gslides");
    expect(broken).toMatchObject({ kind: "details", format: "Google Slides shortcut" });
  });
});
