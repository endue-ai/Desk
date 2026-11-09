import { expect, type Page, test } from "@playwright/test";

// The plugin frames' CSP (ADR 0048), which this server serves as the app does: workers from blob:,
// WebAssembly, fetch of the desk's own URLs; eval and other origins stay blocked. Every surface loads
// on a host of its own, <surface>.<plugin label>.localhost here (#36).
const worker = '[data-surface="test.worker"]';
const hello = '[data-surface="example.hello-ui"]';

async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`/frames.html${query}`);
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
}

/** `location.origin` inside a plugin's frame, once its page has loaded. */
async function originOf(page: Page, id: string): Promise<string> {
  const frame = () => page.frames().find((f) => f.url().includes(`/plugins/${id}/`));
  await expect.poll(() => frame()?.url() ?? "").toContain(`/plugins/${id}/`);
  return (await frame()?.evaluate(() => location.origin)) ?? "";
}

test("a plugin frame runs a worker that compiles WebAssembly, fetches its files, and cannot eval", async ({
  page,
}) => {
  const served = await page.request.get("/plugins/test.worker/ui/index.html");
  const csp = served.headers()["content-security-policy"] ?? "";
  // Scheme-wide: the shared host and every surface's, as `desk-plugin:` in the app.
  const port = new URL(served.url()).port;
  const sources = `http://127.0.0.1:${port} http://localhost:${port} http://*.localhost:${port}`;
  expect(csp).toContain(`worker-src blob: ${sources};`);
  expect(csp).toContain(`connect-src ${sources};`);
  expect(csp).toContain("'wasm-unsafe-eval'");
  expect(csp).not.toContain("'unsafe-eval'");

  await open(page);
  expect(await originOf(page, "test.worker")).toBe(`http://main.test-worker.localhost:${port}`);
  const frame = page.frameLocator(`${worker} iframe`);
  await expect(page.locator(`${worker} iframe`)).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame.getByTestId("eval")).toHaveText("blocked");
  await expect(frame.getByTestId("fetch")).toHaveText("a file of the plugin");
  await expect(frame.getByTestId("worker")).toHaveText("15");
  await expect(frame.getByTestId("wasm")).toHaveText("7");
  await expect(frame.getByTestId("worker-fetch")).toHaveText("a file of the plugin");
  // The surface's own origin opened nothing beyond the desk's.
  await expect(frame.getByTestId("elsewhere")).toHaveText("blocked by connect-src");
});

test("two surfaces of one plugin have their own origins, and each loads, calls the bridge and reloads", async ({
  page,
  context,
}) => {
  const second = await context.newPage();
  await open(page);
  await open(second, "?surface=second");
  const port = new URL(page.url()).port;
  const origins = {
    main: `http://main.example-hello--ui.localhost:${port}`,
    second: `http://second.example-hello--ui.localhost:${port}`,
  };
  for (const [name, desk] of [
    ["main", page],
    ["second", second],
  ] as const) {
    expect(await originOf(desk, "example.hello-ui")).toBe(origins[name]);
    const frame = desk.frameLocator(`${hello} iframe`);
    await expect(frame.getByTestId("bridge")).toHaveText("bridge: ok, 0 grants");
    const log = await desk.evaluate(() =>
      window.__desk.stub.log.map((entry) => [entry.caller ?? "desk", entry.request.method]),
    );
    expect(log).toContainEqual(["example.hello-ui", "perm.query"]);

    await frame.getByRole("button", { name: "Count" }).click();
    await expect(frame.getByTestId("count")).toHaveText("1");
    await desk.evaluate(() =>
      window.__desk.stub.emit({
        event: "plugin.changed",
        data: { plugin: "example.hello-ui", change: "updated", revision: 2 },
      }),
    );
    await expect(frame.getByTestId("revision")).toHaveText("revision 2");
    await expect(frame.getByTestId("count")).toHaveText("1");
    expect(await originOf(desk, "example.hello-ui")).toBe(origins[name]);
  }
});

test("a surface's host refuses another plugin's path with 403 and serves the desk's files", async ({
  page,
}) => {
  await open(page);
  const port = new URL(page.url()).port;
  const statuses = await page.evaluate(async (base) => {
    const status = (path: string) => fetch(`${base}${path}`).then((r) => r.status);
    return {
      own: await status("/plugins/test.worker/ui/data.txt"),
      other: await status("/plugins/example.hello-ui/ui/index.html"),
      sheet: await status("/_desk/tokens.css"),
    };
  }, `http://main.test-worker.localhost:${port}`);
  expect(statuses).toEqual({ own: 200, other: 403, sheet: 200 });
});
