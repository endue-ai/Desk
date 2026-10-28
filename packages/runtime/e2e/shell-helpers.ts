import type { Page } from "@playwright/test";

export const DESK = { width: 1440, height: 900 };

/** Open the shell fixture and wait until the saved desk is restored. */
export async function openShell(page: Page, query = ""): Promise<void> {
  await page.goto(`/shell.html${query}`);
  await page.waitForFunction(() => window.__shell !== undefined);
  await page.evaluate(() => window.__shell.desk.ready);
}

/** Advance the manual clock by `ms` in 16 ms frames. */
export function step(page: Page, ms: number): Promise<void> {
  return page.evaluate((m) => window.__shell.step(m), ms);
}

/** Count elements filled with the primary lavender (thin progress lines excluded). */
export function primaryFills(page: Page): Promise<number> {
  return page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.background = "var(--primary)";
    document.body.append(probe);
    const primary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll("#desk *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 2 && r.width > 0 && getComputedStyle(el).backgroundColor === primary;
    }).length;
  });
}
