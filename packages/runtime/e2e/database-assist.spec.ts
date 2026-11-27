import { expect, type Frame, type Page, test } from "@playwright/test";

// Eris in a console of endue.database (PG-90, ADR 0345) on the fixture's scripted PostgreSQL
// connection `fixture-pg`, with the fixture page's scripted brain (plugins/database/tests/
// assist-fixture.ts): Mod+I asks for a sentence (a desk command stands in for the palette), the
// first ask shows what is sent, the proposal marks a write and the server's check, and "Put in the
// console" puts the statement in the editor without running it; Mod+E explains the statement, put
// aside leaves the console as it was; what the console sends can be read again.
const SURFACE = '[data-surface="endue.database"]';
const SENTENCE = "remove the people without orders";
const DELETE = "delete from people where id not in (select person from orders)";

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

async function open(page: Page) {
  await page.goto("/database.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate((sentence) => {
    window.__desk.runtime.commands.define("desk.palette.pick", {
      title: "Pick",
      owner: "desk",
      run: (args) => {
        const title = String((args as { title?: string }).title);
        window.__desk.commands.push(title);
        return title.startsWith("Eris") ? sentence : "";
      },
    });
  }, SENTENCE);
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

const value = (frame: Frame) =>
  frame.evaluate(() => (document.getElementById("editor") as HTMLTextAreaElement).value);
const setValue = (frame: Frame, text: string, caret = 0) =>
  frame.evaluate(
    ([text, caret]) => {
      const editor = document.getElementById("editor") as HTMLTextAreaElement;
      editor.value = text;
      editor.setSelectionRange(caret, caret);
    },
    [text, caret] as const,
  );

test("Eris writes a statement from a sentence as a proposal that goes into the console unrun", async ({
  page,
}) => {
  const frame = await open(page);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.database.console", { connection: "fixture-pg" }),
  );
  const editor = frame.getByRole("textbox", { name: "SQL" });
  await expect(editor).toBeVisible();
  await setValue(frame, "");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+I");

  // The first ask shows what is sent: the sentence and the schema's names, no rows.
  const sent = frame.locator("form.assist-sent");
  await expect(sent.getByRole("heading")).toHaveText("What is sent to Eris");
  const what = sent.getByLabel("What is sent");
  await expect(what).toContainText(SENTENCE);
  await expect(what).toContainText("public.people");
  await expect(what).toContainText("Who buys");
  await expect(sent.getByRole("note")).toHaveText(
    "The console has no rows from a last run to take a sample of.",
  );
  await sent.getByRole("button", { name: "Send" }).press("Enter");

  // The proposal: a write, marked, and planned by the server without running.
  const proposal = frame.locator("form.assist-proposal");
  await expect(proposal.getByRole("heading")).toHaveText("Eris proposes a statement");
  await expect(proposal.getByRole("textbox", { name: "Proposal" })).toHaveValue(DELETE);
  await expect(proposal.locator(".assist-marks")).toContainText("Writes: DELETE");
  await expect(proposal.locator(".assist-server")).toContainText("Checked by the server");
  await proposal.getByRole("button", { name: "Put in the console" }).press("Enter");
  await expect(proposal).toHaveCount(0);
  await expect.poll(() => value(frame)).toBe(DELETE);
  await expect(frame.locator("#status")).toHaveText(
    "Eris's proposal is in the console; nothing ran.",
  );
  expect(await page.evaluate(() => window.__desk.commands)).toContain(
    "Eris: what should the statement do?",
  );

  // Mod+E explains the statement at the caret; put aside, the console stays as it was.
  await setValue(frame, "select * from people", 3);
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+E");
  await expect(proposal.getByRole("heading")).toHaveText("Eris explains the statement");
  await expect(proposal.getByRole("textbox", { name: "Proposal" })).toHaveValue(
    "-- Eris: Reads every person, in no set order.\n",
  );
  await proposal.getByRole("button", { name: "Put aside" }).press("Enter");
  await expect(frame.locator("#status")).toHaveText(
    "Eris's proposal is put aside: the console is as it was.",
  );
  expect(await value(frame)).toBe("select * from people");

  // What this console sends can be read at any time.
  // The command answers when the dialog closes, so the page does not wait for it here.
  await page.evaluate(() => {
    void window.__desk.runtime.commands.run("endue.database.assist-sent", {});
  });
  await expect(sent.getByRole("heading")).toHaveText("What this console sends to Eris");
  await expect(sent.getByLabel("What is sent")).toContainText("select * from people");
  await sent.getByRole("button", { name: "Close" }).press("Enter");
  await expect(sent).toHaveCount(0);
});
