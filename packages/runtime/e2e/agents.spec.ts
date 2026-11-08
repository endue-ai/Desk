import { expect, type Frame, type Page, test } from "@playwright/test";

// endue.agents (plugins/agents) on the browser stub's agents.* and the shared studio.* stub
// (fixture/agents.ts: Miso, Mailie and Scout), at the fixtures' clock: Saturday 7 November 2026,
// 09:00 UTC. The snapshots are the page's structure and text (ADR 0011): Home's cards and board, an
// endue agent's and a local agent's Studio, and New agent's catalog.
const SURFACE = '[data-surface="endue.agents"]';

test.use({ timezoneId: "UTC", locale: "en-US", viewport: { width: 1280, height: 900 } });

/** Open the fixture page and endue.agents, and resolve with its frame once the cards show. */
async function open(page: Page, query = "", cards = 5): Promise<Frame> {
  await page.clock.setFixedTime("2026-11-07T09:00:00Z");
  await page.goto(`/agents.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.agents" }),
  );
  await expect(page.locator(`${SURFACE} iframe`)).toBeVisible();
  const frame = await (await page.locator(`${SURFACE} iframe`).elementHandle())?.contentFrame();
  if (!frame) throw new Error("no endue.agents frame");
  await expect(frame.locator("#grid > li")).toHaveCount(cards);
  return frame;
}

/** The page's structure and text under `selector`: elements, the attributes that carry state. */
async function tree(frame: Frame, selector: string): Promise<string> {
  const node = await frame.evaluate((selector) => {
    const keep =
      /^(role|aria-(label|pressed|selected|checked|busy|invalid)|hidden|disabled|class|data-[a-z]+|type|label|variant|datetime)$/;
    type Tree = Record<string, unknown>;
    const walk = (el: Element): Tree => {
      const out: Tree = { tag: el.tagName.toLowerCase() };
      for (const { name, value } of [...el.attributes]) if (keep.test(name)) out[name] = value;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) out.value = el.value;
      const text = [...el.childNodes]
        .filter((c) => c.nodeType === Node.TEXT_NODE)
        .map((c) => c.textContent?.trim() ?? "")
        .filter(Boolean)
        .join(" ");
      if (text) out.text = text;
      const children = [...el.children].filter((c) => !["SCRIPT", "STYLE"].includes(c.tagName));
      if (children.length) out.children = children.map(walk);
      return out;
    };
    const root = document.querySelector(selector);
    if (!root) throw new Error(`no ${selector}`);
    return walk(root);
  }, selector);
  return `${JSON.stringify(node, null, 2)}\n`;
}

test.describe("endue.agents", () => {
  test("Home shows endue and local agents as one grid of cards, with chips and search", async ({
    page,
  }) => {
    const frame = await open(page);
    const names = frame.locator("#grid .name");
    // Working, then online by the latest activity, then disabled, then offline.
    await expect(names).toHaveText(["Miso", "Claude Code", "Scout", "Mailie", "Codex"]);
    await expect(frame.locator("#grid .source")).toHaveText([
      "endue",
      "Local",
      "endue",
      "endue",
      "Local",
    ]);
    await expect(frame.locator("#counts")).toHaveText("endue 3 · Local 2 · 1 working");
    expect(await tree(frame, "#page-home")).toMatchSnapshot("home.json");

    await frame.getByRole("button", { name: /^Local/ }).click();
    await expect(names).toHaveText(["Claude Code", "Codex"]);
    await frame.locator("#search").fill("codex");
    await expect(names).toHaveText(["Codex"]);
    await frame.locator("#search").fill("");
    await frame.getByRole("button", { name: /^All/ }).click();
    await expect(names).toHaveCount(5);
  });

  test("the Activity tab shows the board: Waiting, Active, Failed and Done", async ({ page }) => {
    const frame = await open(page);
    await frame.getByRole("tab", { name: "Activity" }).click();
    const columns = frame.locator("#board .column-head");
    await expect(columns).toHaveText([/Waiting\s*1/, /Active\s*1/, /Failed\s*1/, /Done\s*4/]);
    expect(await tree(frame, "#panel-activity")).toMatchSnapshot("activity.json");
    await frame.locator("#agent-chips").getByRole("button", { name: /Scout/ }).click();
    await expect(columns).toHaveText([/Waiting\s*0/, /Active\s*0/, /Failed\s*1/, /Done\s*0/]);
  });

  test("an endue agent's Studio: its card with its facets, and an inspector beside it", async ({
    page,
  }) => {
    const frame = await open(page);
    await frame.getByRole("button", { name: /^Miso, endue/ }).click();
    await expect(frame.locator("#page-studio")).toBeVisible();
    await expect(frame.locator(".facet")).toHaveCount(6);
    await expect(frame.locator('[data-facet="skills"] .facet-hint')).toHaveText("0 skills");
    await expect(frame.locator('[data-facet="prompt"] .facet-hint')).toHaveText("Revision 1");
    await frame.locator('[data-facet="prompt"]').click();
    await expect(frame.locator("#inspector h2")).toHaveText("Prompt");
    await expect(frame.locator("#field-prompt")).toHaveValue("Answer briefly, in Korean.");
    expect(await tree(frame, "#page-studio")).toMatchSnapshot("studio-endue.json");

    // Delete waits for the agent's name, typed exactly.
    await frame.locator('[data-facet="settings"]').click();
    await frame.getByRole("button", { name: "Delete agent" }).click();
    const dialog = frame.locator("#delete-dialog");
    await expect(dialog).toHaveAttribute("open", "");
    await frame.locator("#delete-name").fill("miso");
    await expect(frame.locator("#delete-confirm")).toBeDisabled();
    await frame.locator("#delete-name").fill("Miso");
    await frame.locator("#delete-confirm").click();
    await expect(frame.locator("#page-home")).toBeVisible();
    await expect(frame.locator("#status")).toHaveText("The agent is deleted.");
    await expect(frame.locator("#grid .name")).toHaveText([
      "Claude Code",
      "Scout",
      "Mailie",
      "Codex",
    ]);
  });

  test("a local agent's Studio: the same card, and a chat whose reply streams", async ({
    page,
  }) => {
    const frame = await open(page);
    await frame.getByRole("button", { name: "Chat with Claude Code" }).click();
    await expect(frame.locator("#chat")).toBeVisible();
    await expect(frame.locator('[data-facet="version"] .facet-hint')).toHaveText("2.1.3");
    await frame.locator("#chat-input").fill("How does the bridge check calls?");
    await frame.locator("#chat-input").press("Enter");
    await expect(frame.locator(".turn.assistant")).toHaveAttribute("data-state", "done");
    await expect(frame.locator(".turn.assistant")).toContainText("Nothing changes without one.");
    await expect(frame.locator(".turn.assistant .tools")).toContainText("Read");
    expect(await tree(frame, "#page-studio")).toMatchSnapshot("studio-local.json");
  });

  test("New agent: Find an agent for me shows the catalog and what fits", async ({ page }) => {
    const frame = await open(page);
    await frame.locator("#new-agent").click();
    await expect(frame.locator("#catalog .name")).toHaveText(["Mailie", "Kairos", "Scout"]);
    await frame.locator("#find-query").fill("answer customer mail");
    await frame.locator("#find-go").click();
    await expect(frame.locator("#find-heading")).toHaveText("These look like a fit");
    await expect(frame.locator("#catalog .name")).toHaveText(["Mailie"]);
    await expect(frame.locator("#catalog .reason")).toHaveText("Mailie works with mail, support.");
    // Found by keywords, not endue AI's model: the page says so.
    await expect(frame.locator("#find-note")).toBeVisible();
    expect(await tree(frame, "#page-create")).toMatchSnapshot("create-find.json");
    await frame.getByRole("tab", { name: "Build from scratch" }).click();
    await expect(frame.locator("#build-go")).toBeDisabled();
    await frame.locator("#build-name").fill("Joon");
    await frame.locator("#build-role").fill("Answers mail");
    await expect(frame.locator("#build-go")).toBeEnabled();
  });

  test("signed out, the endue side asks to sign in and the local agents still show", async ({
    page,
  }) => {
    const frame = await open(page, "?signedout=1", 2);
    await expect(frame.locator('.note[data-side="endue"]')).toContainText(
      "Sign in to see your endue agents.",
    );
    await expect(frame.locator('.note[data-side="endue"]').getByRole("button")).toHaveText(
      "Sign in",
    );
    await expect(frame.locator("#grid .name")).toHaveText(["Claude Code", "Codex"]);
  });
});
