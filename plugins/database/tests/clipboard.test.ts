// @vitest-environment jsdom
// Copying: the Clipboard API first, so a palette command copies without a key in the page; a block
// as one item with its text and its HTML table (#504); the copy command on a hidden textarea when
// the API refuses or is missing, with the text only; false when both refuse. A page without the
// focus (the palette still closing) waits for it a moment.
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, FOCUS_WAIT_MS } from "../ui/clipboard.js";

const withClipboard = (writeText: ((text: string) => Promise<void>) | undefined) =>
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });

const execCopy = (answer: boolean | Error) => {
  const copied: string[] = [];
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn((command: string) => {
      if (answer instanceof Error) throw answer;
      const area = document.querySelector("textarea.offscreen") as HTMLTextAreaElement | null;
      if (command === "copy") copied.push(area?.value ?? "");
      return answer;
    }),
  });
  return copied;
};

/** A Clipboard API whose write takes items and records each type's text; `refuse` throws. */
const withItems = (refuse = false) => {
  const written: Array<Record<string, string>> = [];
  class Item {
    constructor(readonly types: Record<string, Blob>) {}
  }
  Object.defineProperty(window, "ClipboardItem", { configurable: true, value: Item });
  const write = vi.fn(async (items: Item[]) => {
    if (refuse) throw new DOMException("Write permission denied.", "NotAllowedError");
    for (const item of items) {
      const entries = Object.entries(item.types).map(async ([type, blob]) => {
        expect(blob.type).toBe(type);
        return [type, await blob.text()] as const;
      });
      written.push(Object.fromEntries(await Promise.all(entries)));
    }
  });
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { write, writeText },
  });
  return { written, write, writeText };
};

const withFocus = (has: boolean) =>
  Object.defineProperty(document, "hasFocus", { configurable: true, value: () => has });

afterEach(() => {
  withClipboard(undefined);
  Object.defineProperty(window, "ClipboardItem", { configurable: true, value: undefined });
  withFocus(true);
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("copyText", () => {
  it("writes through the Clipboard API and leaves the page as it was", async () => {
    const writeText = vi.fn(async () => {});
    withClipboard(writeText);
    const copied = execCopy(true);
    await expect(copyText(document, "a\tb\n1\t2")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("a\tb\n1\t2");
    expect(copied).toEqual([]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("falls back to the copy command when the API refuses, and removes its textarea", async () => {
    withClipboard(async () => {
      throw new DOMException("Document is not focused.", "NotAllowedError");
    });
    const copied = execCopy(true);
    await expect(copyText(document, "postgresql://me@db/shop")).resolves.toBe(true);
    expect(copied).toEqual(["postgresql://me@db/shop"]);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("uses the copy command where there is no Clipboard API", async () => {
    withClipboard(undefined);
    const copied = execCopy(true);
    await expect(copyText(document, "x")).resolves.toBe(true);
    expect(copied).toEqual(["x"]);
  });

  it("says false when both refuse, or the command throws", async () => {
    withClipboard(async () => {
      throw new Error("refused");
    });
    execCopy(false);
    await expect(copyText(document, "x")).resolves.toBe(false);
    execCopy(new Error("not allowed"));
    await expect(copyText(document, "x")).resolves.toBe(false);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("writes a block as one item holding its text and its HTML table", async () => {
    const api = withItems();
    const html = "<table><tr><td>1</td><td>Ada</td></tr></table>";
    await expect(copyText(document, "1\tAda", html)).resolves.toBe(true);
    expect(api.written).toEqual([{ "text/plain": "1\tAda", "text/html": html }]);
    expect(api.writeText).not.toHaveBeenCalled();
    await copyText(document, "plain");
    expect(api.writeText).toHaveBeenCalledWith("plain");
    expect(api.write).toHaveBeenCalledOnce();
  });

  it("falls back to the copy command with the text only when the item is refused", async () => {
    const api = withItems(true);
    const copied = execCopy(true);
    await expect(copyText(document, "1\tAda", "<table></table>")).resolves.toBe(true);
    expect(api.write).toHaveBeenCalledOnce();
    expect(copied).toEqual(["1\tAda"]);
  });

  it("waits for the page's focus before it writes, and no longer than a moment", async () => {
    vi.useFakeTimers();
    const api = withItems();
    withFocus(false);
    const first = copyText(document, "a");
    await vi.advanceTimersByTimeAsync(10);
    expect(api.writeText).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("focus"));
    await expect(first).resolves.toBe(true);
    expect(api.writeText).toHaveBeenCalledWith("a");
    const second = copyText(document, "b");
    await vi.advanceTimersByTimeAsync(FOCUS_WAIT_MS - 10);
    expect(api.writeText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    await expect(second).resolves.toBe(true);
    expect(api.writeText).toHaveBeenLastCalledWith("b");
  });
});
