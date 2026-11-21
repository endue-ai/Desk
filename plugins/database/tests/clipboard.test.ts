// @vitest-environment jsdom
// Copying: the Clipboard API first, so a palette command copies without a key in the page; the
// copy command on a hidden textarea when the API refuses or is missing; false when both refuse.
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../ui/clipboard.js";

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

afterEach(() => {
  withClipboard(undefined);
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
});
