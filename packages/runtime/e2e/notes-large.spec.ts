import { expect, type Page, test } from "@playwright/test";
import { openShell } from "./shell-helpers";

const large = "~/Notes/endue-large.txt";
const small = "~/Notes/endue-short.txt";
const marker = "endue edit";
const run = (page: Page, id: string, args: Record<string, unknown>) =>
  page.evaluate(
    ([command, payload]) => window.__shell.desk.runtime.commands.run(command, payload),
    [id, args] as const,
  );

test("large notes keep their complete wrapped text, undo history and saved edits", async ({
  page,
}) => {
  await openShell(page, "?files=1&apps=1&lang=en");
  await page.evaluate(
    ([longPath, shortPath]) => {
      const line = "endue words ".repeat(12);
      window.__shell.files[longPath] = "data:text/plain;base64," + btoa((line + "\n").repeat(9000));
      window.__shell.files[shortPath] = "data:text/plain;base64," + btoa("endue");
    },
    [large, small] as const,
  );
  await run(page, "desk.files.open", { path: large });
  const notes = page.frameLocator('[data-surface="endue.notes"] iframe');
  const editor = notes.getByRole("textbox", { name: "endue-large.txt" });
  await expect(editor).toBeFocused();
  const visibleLines = editor.locator(".cm-line");
  await expect(visibleLines.first()).toBeVisible();
  expect(await visibleLines.count()).toBeLessThan(9000);
  await expect(editor).toHaveAttribute("aria-multiline", "true");
  await expect(editor).toHaveCSS("white-space", /pre-wrap|break-spaces/);
  const field = notes.locator("#note-text");
  const size = await field.evaluate((node: HTMLTextAreaElement) => node.value.length);
  const middle = Math.floor(size / 2);
  await field.evaluate((node: HTMLTextAreaElement, pos) => {
    node.focus();
    node.setSelectionRange(pos, pos);
  }, middle);
  await page.keyboard.insertText(marker);
  const edited = () =>
    field.evaluate((node: HTMLTextAreaElement, pos) => node.value.slice(pos, pos + 10), middle);
  await expect.poll(edited).toBe(marker);
  await editor.press("ControlOrMeta+z");
  await expect.poll(edited).not.toBe(marker);
  await editor.press("ControlOrMeta+Shift+z");
  await expect.poll(edited).toBe(marker);
  await expect(notes.locator("#note-count")).toContainText(`${size + marker.length} characters`);
  await run(page, "desk.files.save", {});
  const saved = await page.evaluate((path) => {
    const writes = window.__shell.stub.log.map((entry) => entry.request);
    const write = writes
      .reverse()
      .find((req) => req.method === "fs.write" && req.params.path === path);
    if (write?.method !== "fs.write") return 0;
    const data = write.params.content;
    window.__shell.files[path] = "data:text/plain;base64," + btoa(data);
    return data.length;
  }, large);
  expect(saved).toBe(size + marker.length);
  await run(page, "desk.buffers.close", { id: "file:" + large });
  await run(page, "desk.files.open", { path: large });
  await expect.poll(edited).toBe(marker);
  await run(page, "desk.files.open", { path: small });
  const ordinary = notes.getByRole("textbox", { name: "endue-short.txt" });
  await expect(ordinary).toHaveValue("endue");
  await ordinary.fill("endue note");
  await expect(notes.locator("#note-count")).toContainText("10 characters");
});
