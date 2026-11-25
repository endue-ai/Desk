import { expect, test } from "@playwright/test";

const DOCS = "endue.docs";
const READ = "endue.docs.read";

test("Eris discovers a dormant Docs tool and receives its answer without opening a foreground window", async ({
  page,
}) => {
  await page.goto("/docs.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const section = page.locator(`[data-surface="${DOCS}"]`);
  await expect(section).toHaveCount(0);
  const tools = await page.evaluate(async () => {
    const { client } = window.__desk;
    if (!client) throw new Error("Docs fixture did not expose its client");
    return client.call("cmd.tools", { query: "endue.docs.read" }, { caller: "agent:eris" });
  });
  expect(tools.tools).toEqual([expect.objectContaining({ command: READ, readOnly: true })]);

  const answer = await page.evaluate(async (id) => {
    const { client } = window.__desk;
    if (!client) throw new Error("Docs fixture did not expose its client");
    const caller = "agent:eris";
    const replied = new Promise((resolve) => {
      const off = client.onEvent((event) => {
        if (event.event !== "cmd.answered" || event.data.id !== id || event.data.caller !== caller)
          return;
        off();
        resolve(event.data);
      });
    });
    await client.call(
      "cmd.invoke",
      { id, scope: { permission: "cmd:invoke", ids: [id] } },
      { caller },
    );
    return replied;
  }, READ);
  expect(answer).toMatchObject({
    id: READ,
    ok: false,
    error: { message: expect.stringContaining("No document is open in Docs") },
  });
  await expect(section).toHaveCount(1);
  await expect(section).toBeHidden();
});
