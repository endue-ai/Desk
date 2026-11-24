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
      // This fixture serves files as data URLs. Give this note a writable, in-memory disk.
      const stub = window.__shell.stub;
      const original = stub.call.bind(stub);
      stub.call = (request, caller) => {
        if (
          caller === "endue.notes" &&
          request.method === "fs.write" &&
          request.params.path === longPath
        ) {
          const bytes = request.params.content;
          window.__shell.files[longPath] = "data:text/plain;base64," + btoa(bytes);
          return Promise.resolve({
            id: request.id,
            ok: true,
            result: { bytesWritten: bytes.length },
          });
        }
        return original(request, caller);
      };
    },
    [large, small] as const,
  );
  await run(page, "desk.files.open", { path: large });
  const notes = page.frameLocator('[data-surface^="endue.notes"].is-focused iframe');
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
    field.evaluate(
      (node: HTMLTextAreaElement, { pos, count }) => node.value.slice(pos, pos + count),
      { pos: middle, count: marker.length },
    );
  await expect.poll(edited).toBe(marker);
  await editor.press("ControlOrMeta+z");
  await expect.poll(edited).not.toBe(marker);
  await editor.press("ControlOrMeta+Shift+z");
  await expect.poll(edited).toBe(marker);
  await expect(notes.locator("#note-count")).toContainText(`${size + marker.length} characters`);
  await run(page, "desk.files.save", {});
  const saved = await page.evaluate(
    (path) => atob(window.__shell.files[path]?.split(",")[1] ?? "").length,
    large,
  );
  expect(saved).toBe(size + marker.length);
  await run(page, "desk.buffers.close", { id: "file:" + large });
  await run(page, "desk.files.open", { path: large });
  await expect(editor).toBeVisible();
  await expect.poll(edited).toBe(marker);
  expect(
    await field.evaluate(
      (node: HTMLTextAreaElement, { pos, added }) => {
        const original = ("endue words ".repeat(12) + "\n").repeat(9000);
        return node.value === original.slice(0, pos) + added + original.slice(pos);
      },
      { pos: middle, added: marker },
    ),
  ).toBe(true);
  await run(page, "desk.files.open", { path: small });
  const ordinary = notes.getByRole("textbox", { name: "endue-short.txt" });
  await expect(ordinary).toHaveValue("endue");
  await ordinary.fill("endue note");
  await expect(notes.locator("#note-count")).toContainText("10 characters");
});

test("a wrapped note retains keyboard composition and fits a narrow themed window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await openShell(page, "?files=1&apps=1&heavy=1&lang=en");
  await run(page, "desk.files.open", { path: "~/Notes/long.txt" });
  const notes = page.frameLocator('[data-surface^="endue.notes"].is-focused iframe');
  const viewport = notes.locator(".note-viewport");
  const editor = viewport.getByRole("textbox", { name: "long.txt" });
  const field = notes.locator("#note-text");
  await expect(editor.locator(".cm-line").first()).toBeVisible();
  for (const scheme of ["dark", "light"]) {
    await run(page, "desk.theme." + scheme, {});
    await expect(notes.locator("html")).toHaveAttribute("data-scheme", scheme);
    const bounds = await viewport.evaluate((view) => {
      const pane = view.closest("main");
      if (!pane) throw new Error("The note editor is outside its pane");
      return { view: view.getBoundingClientRect().width, pane: pane.getBoundingClientRect().width };
    });
    expect(bounds.view).toBeLessThanOrEqual(bounds.pane);
    expect(
      await editor.evaluate(
        (node) => getComputedStyle(node).caretColor === getComputedStyle(node).color,
      ),
    ).toBe(true);
  }
  await run(page, "desk.theme.contrast", {});
  await expect(notes.locator("html")).toHaveAttribute("data-contrast", "high");
  if ((await notes.locator("html").getAttribute("data-motion")) !== "reduce") {
    await run(page, "desk.theme.motion", {});
  }
  await expect(notes.locator("html")).toHaveAttribute("data-motion", "reduce");
  await expect(editor).toBeVisible();
  await field.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(0, 0);
  });
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.imeSetComposition", {
      text: "메모",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await session.send("Input.insertText", { text: "메모" });
  } finally {
    await session.detach();
  }
  await expect
    .poll(() => field.evaluate((node: HTMLTextAreaElement) => node.value.slice(0, 2)))
    .toBe("메모");
  await expect(notes.locator("#note-count")).toContainText("4194306 characters");
});
