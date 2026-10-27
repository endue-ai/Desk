import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Opening frame time: the p95 interval between animation frames inside the onboarding frame during
// the first 10 s of the first run (arrival and greeting), in real time.
//   PERF_RECORD=1  write the measurement into e2e/perf/budgets.json as the new baseline
//   otherwise      fail when p95 is more than 25 % over the baseline
const budgets = fileURLToPath(new URL("../../../../e2e/perf/budgets.json", import.meta.url));
const WINDOW_MS = 10_000;

test("opening frame time stays within budget", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/onboarding.html");
  const handle = await page.waitForSelector('[data-surface="endue.onboarding"] iframe');
  const frame = await handle.contentFrame();
  if (!frame) throw new Error("no onboarding frame");
  await frame.waitForFunction(() => document.documentElement.dataset.scene !== undefined);

  const intervals = await frame.evaluate(
    (windowMs) =>
      new Promise<number[]>((resolve) => {
        const out: number[] = [];
        const start = performance.now();
        let last = start;
        const tick = (now: number) => {
          out.push(now - last);
          last = now;
          if (now - start < windowMs) requestAnimationFrame(tick);
          else resolve(out.slice(1));
        };
        requestAnimationFrame(tick);
      }),
    WINDOW_MS,
  );
  const sorted = [...intervals].sort((a, b) => a - b);
  const pick = (q: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  const measured = {
    p50Ms: Math.round(pick(0.5) * 10) / 10,
    p95Ms: Math.round(pick(0.95) * 10) / 10,
    frames: sorted.length,
  };
  console.log("opening frame time:", JSON.stringify(measured));

  const file = JSON.parse(readFileSync(budgets, "utf8"));
  if (process.env.PERF_RECORD) {
    file.openingFrameTime = {
      ...measured,
      windowMs: WINDOW_MS,
      engine: "WebKit (Playwright)",
      platform: `${process.platform}-${process.arch}`,
      recorded: new Date().toISOString().slice(0, 10),
      allowedRegression: 0.25,
    };
    writeFileSync(budgets, `${JSON.stringify(file, null, 2)}\n`);
    return;
  }
  const baseline = file.openingFrameTime;
  expect(baseline, "record a baseline with PERF_RECORD=1 first").toBeTruthy();
  expect(measured.p95Ms).toBeLessThanOrEqual(baseline.p95Ms * (1 + baseline.allowedRegression));
});
