// @vitest-environment jsdom
import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import {
  BridgeClient,
  browserStub,
  type ShellOpenParams,
  stubCommands,
} from "../../../packages/bridge/src/index";

it("document links reach the bridge's actual shell adapter and share one grant", async () => {
  const { createLinks } = await import("../ui/links.js");
  const prompt = vi.fn(() => true);
  const core = stubCommands(() => {}, { prompt });
  const bridge = new BridgeClient(browserStub(core.handlers));
  const open = createLinks({
    call: (method: "shell.open", params: ShellOpenParams) =>
      bridge.call(method, params, { caller: "endue.reader" }),
  });
  await open("https://example.com/");
  await open("mailto:reader@example.com");
  expect(core.state().opened).toEqual([
    { caller: "endue.reader", target: "https://example.com/", reveal: false },
    { caller: "endue.reader", target: "mailto:reader@example.com", reveal: false },
  ]);
  expect(prompt).toHaveBeenCalledOnce();
});

it("external document links use one scoped shell.open and only the three allowed schemes", async () => {
  expect(
    existsSync(join(import.meta.dirname, "../ui/links.js")),
    "external link handler is implemented",
  ).toBe(true);
  const { createLinks } = await import("../ui/links.js");
  const call = vi.fn(async (_method, _params) => ({}));
  const open = createLinks({ call });
  await open("https://example.com/");
  await open("mailto:reader@example.com");
  const scope = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
  expect(call.mock.calls).toEqual([
    ["shell.open", { target: "https://example.com/", scope }],
    ["shell.open", { target: "mailto:reader@example.com", scope }],
  ]);
  call.mockClear();
  for (const url of [
    "javascript:alert(1)",
    "file:///tmp/private",
    "#chapter2",
    "ftp://example.com/",
  ])
    await open(url);
  expect(call).not.toHaveBeenCalled();
});

it("a shell.open refusal does not ask again or retry", async () => {
  const { createLinks } = await import("../ui/links.js");
  const refused = { code: "permission_denied" };
  const call = vi.fn(async (_method, _params) => {
    throw refused;
  });
  await expect(createLinks({ call })("https://example.com/")).rejects.toBe(refused);
  expect(call).toHaveBeenCalledExactlyOnceWith("shell.open", {
    target: "https://example.com/",
    scope: { permission: "shell:open", schemes: ["http", "https", "mailto"] },
  });
});

it("an EPUB web link uses shell.open while its internal link keeps jumping", async () => {
  const { createChapters } = await import("../ui/chapters.js");
  const { readEpub } = await import("../ui/formats/epub.js");
  const { readZip } = await import("../ui/formats/zip.js");
  const { epub } = await import("./build/books");
  const { createLinks } = await import("../ui/links.js");
  const book = await readEpub(await readZip(epub(3)));
  const call = vi.fn(async (_method, _params) => ({}));
  const go = vi.fn();
  const host = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.append(host);
  document.body.replaceChildren(scroller);
  const chapters = createChapters(host, scroller, {
    moved() {},
    go,
    external: createLinks({ call }),
  });
  await chapters.show(book, 0);
  host.shadowRoot?.querySelector<HTMLAnchorElement>("a.external")?.click();
  expect(call).toHaveBeenCalledExactlyOnceWith("shell.open", {
    target: "https://example.com/",
    scope: { permission: "shell:open", schemes: ["http", "https", "mailto"] },
  });
  host.shadowRoot
    ?.querySelector<HTMLAnchorElement>('a[href="OEBPS/text/road.xhtml#bend"]')
    ?.click();
  expect(go).toHaveBeenCalledWith({ unit: 1, anchor: "bend" });
  expect(call).toHaveBeenCalledTimes(1);
  const external = host.shadowRoot?.querySelector<HTMLAnchorElement>("a.external");
  expect(external?.tabIndex).toBe(0);
  expect(external?.getAttribute("role")).toBe("link");
  external?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(call).toHaveBeenCalledTimes(2);
});

it("a PDF URI annotation routes through the same scoped external link action", async () => {
  const { paintPdf } = await import("../ui/pdf-paint.js");
  const { openPdf } = await import("../ui/formats/pdf.js");
  const { loadPdfjs } = await import("./pdfjs");
  const { pdf } = await import("./build/pdf");
  const { createLinks } = await import("../ui/links.js");
  const pdfjs = await loadPdfjs();
  const book = await openPdf(pdf(), { pdfjs });
  const call = vi.fn(async (_method, _params) => ({}));
  const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const host = document.createElement("div");
  try {
    await paintPdf(
      {
        TextLayer: class {
          async render() {}
        },
        AnnotationLayer: class {
          async render({
            annotations,
            div,
            linkService,
          }: {
            annotations: Array<{ url?: string }>;
            div: HTMLElement;
            linkService: { addLinkAttributes(link: HTMLAnchorElement, url: string): void };
          }) {
            for (const annotation of annotations)
              if (annotation.url) {
                const link = document.createElement("a");
                linkService.addLinkAttributes(link, annotation.url);
                div.append(link);
              }
          }
        },
      },
      book,
      0,
      host,
      1,
      { go() {}, external: createLinks({ call }) },
    );
    host.querySelector("a")?.click();
    expect(call).toHaveBeenCalledExactlyOnceWith("shell.open", {
      target: "https://example.com/",
      scope: { permission: "shell:open", schemes: ["http", "https", "mailto"] },
    });
  } finally {
    context.mockRestore();
    await book.close();
  }
});
