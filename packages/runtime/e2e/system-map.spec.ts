import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test } from "@playwright/test";

const plugin = join(import.meta.dirname, "../../../plugins/system-map");
const catalog = readFileSync(join(plugin, "messages/en.json"), "utf8");

// Exercise the production page and collectors with deterministic process events in the browser.
const host = `
  export function defineUiPlugin(plugin) {
    const listeners = new Set();
    let next = 0;
    plugin.mount({
      messages: {
        t: (key, params = {}) => (${catalog}[key] ?? key).replace("{time}", params.time ?? ""),
        language: () => "en", onChange: () => () => {}
      },
      perm: {request: async () => ({granted: true})},
      bridge: {
        onEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
        async call(method, {command}) {
          const procId = String(++next);
          const data = command === "/sbin/ifconfig" ? "en0: flags=1<UP> mtu 1500\\n\\tinet 192.0.2.10" : "";
          for (const fn of listeners) {
            fn({event:"proc.output", data:{procId, stream:"stdout", encoding:"utf8", data}});
            fn({event:"proc.exit", data:{procId, code:0}});
          }
          return {procId};
        }
      }
    });
  }
`;

for (const scheme of ["dark", "light"] as const) {
  test(`System map opens interface details at 360px in ${scheme}`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 700 });
    await page.emulateMedia({
      colorScheme: scheme,
      reducedMotion: "reduce",
      forcedColors: scheme === "dark" ? "active" : "none",
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "userAgentData", { value: { platform: "macOS" } });
    });
    await page.route("**/_desk/plugin-sdk.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: host }),
    );
    await page.route("**/system-map-fixture/*", (route) => {
      const name = basename(new URL(route.request().url()).pathname);
      return route.fulfill({ path: join(plugin, "ui", name) });
    });
    await page.goto("/system-map-fixture/index.html");
    await page.getByRole("button", { name: "Read system" }).click();
    await page.locator('[data-id="network"]').click();
    await page.locator('[data-id="interfaces"]').click();
    await page.getByRole("button", { name: "en0" }).press("Enter");
    await expect(page.getByRole("heading", { name: "en0" })).toBeVisible();
    await expect(page.locator("#details")).toContainText("192.0.2.10");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
  });
}
