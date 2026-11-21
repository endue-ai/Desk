import { expect, type Frame, type Page, test } from "@playwright/test";

// The SQL console's editor component (ADR 0282) in endue.database's sandboxed frame, on the browser
// stub with the scripted SQLite fixture (people and orders), driven by the keyboard: find and
// replace, several carets and a column selection, bracket marks, folds, the toggles, an undo history
// per console, completion from the schema, an IME, the roles a screen reader reads, and a 5 MB script
// scrolled and typed into while a timer chain in the frame measures its longest task.
const SURFACE = '[data-surface="endue.database"]';
/** A frame budget with room for a loaded machine, as the heavy-open measure allows. */
const FRAME_MS = 100;

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.database" }),
  );
  const iframe = page.locator(`${SURFACE} iframe`);
  await expect(iframe).toBeVisible();
  await iframe.evaluate((el) => {
    el.style.cssText += ";width:898px!important;height:558px!important";
  });
  const frame = await (await iframe.elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.database frame");
  await expect(frame.locator("#tree [role=treeitem]").first()).toContainText("fixture");
  return frame;
}

const run = (page: Page, command: string, args: Record<string, unknown>) =>
  page.evaluate(([command, args]) => window.__desk.runtime.commands.run(command, args), [
    command,
    args,
  ] as const);

/** A console on the fixture connection with its editor focused. */
async function console_(page: Page, frame: Frame) {
  await run(page, "endue.database.console", { connection: "fixture" });
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await editor.focus();
  return editor;
}

/** The editor's text, through the console's textarea handle. */
const value = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);
const setValue = (frame: Frame, text: string) =>
  frame.evaluate((text) => {
    (document.getElementById("editor") as HTMLTextAreaElement).value = text;
  }, text);
const mac = (frame: Frame) => frame.evaluate(() => /Mac/u.test(navigator.platform));

test("the editor is a labelled text box that runs, and finds and replaces by the keyboard alone", async ({
  page,
}) => {
  const frame = await open(page);
  const editor = await console_(page, frame);
  await expect(editor).toHaveAttribute("aria-multiline", "true");
  await page.keyboard.type("select * from people;");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(frame.locator("#summary")).toContainText("Done");
  await expect(frame.locator("#result [role=gridcell]").first()).toHaveText("1");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("select name from people where name = 'Bob';");
  await page.keyboard.press("ControlOrMeta+F");
  const bar = frame.getByRole("search", { name: "Find and replace" });
  await expect(bar).toBeVisible();
  const find = bar.getByRole("textbox", { name: "Find" });
  await expect(find).toBeFocused();
  await page.keyboard.type("name");
  await expect(bar.getByRole("status")).toHaveText("2 matches");
  await page.keyboard.press("Enter");
  // Whole word, then a regular expression, each a checkbox the keyboard reaches.
  for (const label of ["Whole word", "Regular expression", "Match case"])
    await expect(bar.getByRole("checkbox", { name: label })).toBeVisible();
  const replace = bar.getByRole("textbox", { name: "Replace" });
  for (let i = 0; i < 8 && !(await replace.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press("Tab");
  await expect(replace).toBeFocused();
  await page.keyboard.type("id");
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(await value(frame)).toBe("select id from people where id = 'Bob';");
  await find.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("i[a-z]");
  await expect(bar.getByRole("status")).toHaveText("0 matches");
  await bar.getByRole("checkbox", { name: "Regular expression" }).focus();
  await page.keyboard.press("Space");
  await expect(bar.getByRole("status")).toHaveText("2 matches");
  await page.keyboard.press("Escape");
  await expect(bar).toBeHidden();
  await expect(editor).toBeFocused();
});

test("several carets, a column selection, bracket marks, folds and the toggles", async ({
  page,
}) => {
  const frame = await open(page);
  const editor = await console_(page, frame);
  const isMac = await mac(frame);
  await setValue(frame, "aaa\nbbb\nccc");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ControlOrMeta+Alt+ArrowDown");
  await page.keyboard.press("ControlOrMeta+Alt+ArrowDown");
  await page.keyboard.type("x");
  expect(await value(frame)).toBe("xaaa\nxbbb\nxccc");
  await page.keyboard.press("Escape");

  // Alt+drag from the first line's first column to the third line's third: a column of carets.
  const at = (line: number, column: number) =>
    frame.evaluate(
      ([line, column]) => {
        const el = document.querySelectorAll(".cm-line")[line] as HTMLElement;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const node = walker.nextNode() as Text;
        const range = document.createRange();
        range.setStart(node, column);
        range.setEnd(node, column);
        const r = range.getBoundingClientRect();
        return { x: r.left, y: r.top + r.height / 2 };
      },
      [line, column] as const,
    );
  const offset = await page.locator(`${SURFACE} iframe`).boundingBox();
  if (!offset) throw new Error("no frame box");
  const from = await at(0, 1);
  const to = await at(2, 3);
  await page.keyboard.down("Alt");
  await page.mouse.move(offset.x + from.x, offset.y + from.y);
  await page.mouse.down();
  await page.mouse.move(offset.x + to.x, offset.y + to.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await page.keyboard.type("Z");
  expect(await value(frame)).toBe("xZa\nxZb\nxZc");

  await setValue(frame, "select (1 + (2));");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+Home");
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowRight");
  await expect(frame.locator(".cm-matchingBracket")).toHaveCount(2);
  await expect(frame.locator(".cm-matchingBracket").first()).toHaveText("(");

  await setValue(frame, "select a,\n  b\nfrom t;\nselect 2;");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press(isMac ? "Meta+Alt+BracketLeft" : "Control+Shift+BracketLeft");
  await expect(frame.locator(".cm-foldPlaceholder")).toBeVisible();
  await expect(frame.locator(".cm-line")).toHaveCount(2);
  await page.keyboard.press(isMac ? "Meta+Alt+BracketRight" : "Control+Shift+BracketRight");
  await expect(frame.locator(".cm-foldPlaceholder")).toHaveCount(0);

  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("ControlOrMeta+Alt+Slash");
  expect(await value(frame)).toBe("-- select a,\n--   b\n-- from t;\n-- select 2;");
  await page.keyboard.press("ControlOrMeta+Alt+Slash");
  await page.keyboard.press("Tab");
  expect(await value(frame)).toBe("  select a,\n    b\n  from t;\n  select 2;");
  await page.keyboard.press("Shift+Tab");
  expect(await value(frame)).toBe("select a,\n  b\nfrom t;\nselect 2;");
  // Tab without a selection leaves the editor, as the textarea's did.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Tab");
  await expect(editor).not.toBeFocused();
});

test("each console keeps its own undo history, and a DDL view is read-only", async ({ page }) => {
  const frame = await open(page);
  const editor = await console_(page, frame);
  await page.keyboard.type("select 1;");
  await run(page, "endue.database.ddl", { connection: "fixture", schema: "main", name: "people" });
  await expect(editor).toContainText("people");
  await expect(editor).toHaveAttribute("aria-readonly", "true");
  await editor.focus();
  await page.keyboard.type("nothing");
  await expect(editor).not.toContainText("nothing");
  await run(page, "endue.database.console", { connection: "fixture" });
  await expect(editor).toHaveText("select 1;");
  await expect(editor).toHaveAttribute("aria-readonly", "false");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+Z");
  expect(await value(frame)).toBe("");
  await page.keyboard.press("ControlOrMeta+Shift+Z");
  expect(await value(frame)).toBe("select 1;");
});

test("completion lists the schema's tables at Ctrl+Space, as a listbox, and Enter takes one", async ({
  page,
}) => {
  const frame = await open(page);
  const editor = await console_(page, frame);
  await setValue(frame, "select * from pe");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.press("Control+Space");
  const list = frame.getByRole("listbox");
  const people = list.getByRole("option", { name: /people/u });
  await expect(people).toBeVisible();
  const labels = await list.getByRole("option").allTextContents();
  const index = labels.findIndex((label) => label.startsWith("people"));
  for (let i = 0; i < index; i++) await page.keyboard.press("ArrowDown");
  await expect(people).toHaveAttribute("aria-selected", "true");
  await expect(editor).toHaveAttribute(
    "aria-activedescendant",
    (await people.getAttribute("id")) ?? "",
  );
  // The component takes Enter only once the list has been in sight a moment (75 ms), so a quick
  // Enter while typing still breaks the line.
  await page.waitForTimeout(100);
  await page.keyboard.press("Enter");
  await expect(list).toBeHidden();
  expect(await value(frame)).toBe("select * from people");
});

test("a key while an IME composes never runs a statement", async ({ page }) => {
  const frame = await open(page);
  await console_(page, frame);
  await setValue(frame, "select 1;\n");
  await page.keyboard.press("ControlOrMeta+End");
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.imeSetComposition", { text: "ㅅ", selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press("ControlOrMeta+Enter");
  await cdp.send("Input.insertText", { text: "서" });
  await page.waitForTimeout(300);
  await expect(frame.locator("#summary")).not.toContainText("Done");
  expect(await value(frame)).toBe("select 1;\n서");
});

test("a 5 MB script scrolls and takes typing without a long task in the frame", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const frame = await open(page);
  const editor = await console_(page, frame);
  const opened = await frame.evaluate(() => {
    const line =
      "select id, name, email from people where id = 42 and name like '%a%'; -- a note\n";
    const block = line.repeat(1000);
    let text = "";
    while (text.length < 5 * 1024 * 1024) text += block;
    const start = performance.now();
    (document.getElementById("editor") as HTMLTextAreaElement).value = text;
    return { length: text.length, ms: Math.round(performance.now() - start) };
  });
  expect(opened.length).toBeGreaterThanOrEqual(5 * 1024 * 1024);
  await frame.evaluate(() => {
    const timing = { gaps: [] as number[], on: true };
    (window as unknown as { __timing: typeof timing }).__timing = timing;
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      timing.gaps.push(now - last);
      last = now;
      if (timing.on) setTimeout(tick, 8);
    };
    setTimeout(tick, 8);
  });
  const box = await editor.boundingBox();
  if (!box) throw new Error("no editor box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(16);
  }
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  await editor.pressSequentially("select 1;", { delay: 30 });
  await frame.evaluate(() =>
    (document.getElementById("editor") as HTMLTextAreaElement).setSelectionRange(
      2_600_000,
      2_600_000,
    ),
  );
  await editor.pressSequentially(" x", { delay: 30 });
  for (let i = 0; i < 10; i++) await page.keyboard.press("PageDown", { delay: 20 });
  const gaps = await frame.evaluate(() => {
    const timing = (window as unknown as { __timing: { gaps: number[]; on: boolean } }).__timing;
    timing.on = false;
    return timing.gaps;
  });
  // The lines on screen are drawn from the plugin's lexer, even this far down.
  await expect(frame.locator(".cm-line .tok-keyword").first()).toBeVisible();
  const sorted = [...gaps].sort((a, b) => a - b);
  const longest = Math.round(sorted.at(-1) ?? 0);
  const p95 = Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0);
  const measured = { bytes: opened.length, openMs: opened.ms, ticks: gaps.length, longest, p95 };
  test.info().annotations.push({ type: "5 MB script", description: JSON.stringify(measured) });
  console.log(`database editor, 5 MB script: ${JSON.stringify(measured)}`);
  expect(await value(frame)).toContain("select 1;");
  expect(gaps.length).toBeGreaterThan(50);
  expect(longest, "the frame's longest task while scrolling and typing").toBeLessThan(FRAME_MS);
});
