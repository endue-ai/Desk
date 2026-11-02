import { expect, type Page, test } from "@playwright/test";

type Span = { name: string; start: number; end: number };

/** The desk's start-up phases on the fixture desk, once its plugins, profile and session are in. */
async function phases(page: Page): Promise<Span[]> {
  await page.goto("/desk.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  return page.evaluate(async () => {
    await window.__desk.runtime.plugins?.ready;
    return performance
      .getEntriesByType("measure")
      .filter((m) => m.name.startsWith("desk:"))
      .map((m) => ({ name: m.name.slice(5), start: m.startTime, end: m.startTime + m.duration }));
  });
}

test("the start-up phases leave no gap from the plugin list to the session restore", async ({
  page,
}) => {
  const all = await phases(page);
  const span = (name: string) => {
    const found = all.find((p) => p.name === name);
    expect(found, `phase ${name}`).toBeDefined();
    return found as Span;
  };
  const order = ["plugin list", "command registry", "profile start", "session restore"].map(span);
  // Each starts once the one before it ended (User Timing rounds, so allow a hundredth of a ms).
  for (let i = 1; i < order.length; i++) {
    expect(order[i]?.start).toBeGreaterThanOrEqual((order[i - 1]?.end ?? 0) - 0.01);
  }
});
