import { expect, test } from "@playwright/test";

// The plugin frames' CSP (ADR 0048), which this server serves as the app does: workers from blob:,
// WebAssembly, fetch of the desk's own URLs; eval stays blocked.
const worker = '[data-surface="test.worker"]';

test("a plugin frame runs a worker that compiles WebAssembly, fetches its files, and cannot eval", async ({
  page,
}) => {
  const served = await page.request.get("/plugins/test.worker/ui/index.html");
  const csp = served.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/worker-src blob: http:\/\/127\.0\.0\.1:\d+;/);
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");

  await page.goto("/frames.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const frame = page.frameLocator(`${worker} iframe`);
  await expect(page.locator(`${worker} iframe`)).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame.getByTestId("eval")).toHaveText("blocked");
  await expect(frame.getByTestId("fetch")).toHaveText("a file of the plugin");
  await expect(frame.getByTestId("worker")).toHaveText("15");
  await expect(frame.getByTestId("wasm")).toHaveText("7");
  await expect(frame.getByTestId("worker-fetch")).toHaveText("a file of the plugin");
});
