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

// Not responding (#39): the shell with test.hang, whose frame stops answering the desk's pings on
// command while its page stays free. The page clock (ADR 0013) runs the desk's pings and timers.
test.describe("a window whose frame stops answering", () => {
  const HANG = "test.hang";
  const section = (page: Page) => page.locator(`.desk-surface[data-surface="${HANG}"]`);
  const frame = (page: Page) => page.frameLocator(`.desk-surface[data-surface="${HANG}"] iframe`);
  const question = (page: Page) => page.locator(".desk-not-responding");
  /** What desk.windows.list says of test.hang's pane, as an agent reads it. */
  const listed = (page: Page) =>
    page.evaluate(async (id) => {
      const desk = (await window.__shell.desk.runtime.commands.run("desk.windows.list")) as {
        windows: Array<{ panes: Array<{ plugin?: string; responsiveness?: string }> }>;
      };
      return desk.windows.flatMap((w) => w.panes).find((p) => p.plugin === id);
    }, HANG);

  /** The shell with test.hang mounted, the clock paused, and the frame watched (it answered once). */
  async function open(page: Page): Promise<void> {
    await page.clock.install({ time: 0 });
    await page.goto("/shell.html?hang=1&lang=en");
    await page.waitForFunction(() => window.__shell !== undefined);
    await page.evaluate(() => window.__shell.desk.ready);
    await page.evaluate(() => window.__shell.desk.runtime.plugins?.ready);
    await expect(frame(page).getByTestId("call")).toHaveText("idle");
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
    await page.clock.runFor(2000);
    await expect(section(page)).toHaveAttribute("data-responding", "responding");
  }

  test("shows Not responding on that window only; Wait hides it 10 s; Stop unloads; Reload brings back its last state", async ({
    page,
  }) => {
    await open(page);
    await frame(page).getByTestId("add").click();
    await expect(frame(page).getByTestId("count")).toHaveText("1");
    await frame(page).getByTestId("wedge").click();
    // Its last answer came at most one ping (2 s) before: never before 3 s, always by 5 s.
    await page.clock.runFor(2900);
    await expect(question(page)).toHaveCount(0);
    await page.clock.runFor(2100);
    await expect(question(page)).toHaveCount(1);
    await expect(section(page).locator(".desk-not-responding")).toBeVisible();
    await expect(question(page)).toContainText("Hang has not answered for 5 seconds.");
    await expect(section(page)).toHaveAttribute("data-responding", "late");
    expect(await listed(page)).toMatchObject({ responsiveness: "late" });

    await question(page).getByRole("button", { name: "Wait" }).click();
    await expect(question(page)).toHaveCount(0);
    await page.clock.runFor(9900);
    await expect(question(page)).toHaveCount(0);
    await page.clock.runFor(100);
    await expect(question(page)).toBeVisible();

    await question(page).getByRole("button", { name: "Stop" }).click();
    await expect(section(page).locator("iframe")).toHaveCount(0);
    await expect(question(page)).toHaveCount(0);
    await expect(section(page)).toContainText("Stopped because it was not responding.");
    expect(await listed(page)).toMatchObject({ responsiveness: "stopped" });
    // In sight, it stays stopped until the person reloads it.
    await page.clock.runFor(30_000);
    await expect(section(page).locator("iframe")).toHaveCount(0);

    await section(page).getByRole("button", { name: "Reload" }).click();
    await expect(frame(page).getByTestId("count")).toHaveText("1");
    await expect(frame(page).getByTestId("call")).toHaveText("idle");
    expect(await listed(page)).not.toHaveProperty("responsiveness");
    await page.clock.runFor(2000);
    await expect(section(page)).toHaveAttribute("data-responding", "responding");
  });

  test("a plugin that awaits a slow bridge call keeps answering and is never flagged", async ({
    page,
  }) => {
    await open(page);
    await frame(page).getByTestId("slow").click();
    await expect(frame(page).getByTestId("call")).toHaveText("waiting");
    await page.clock.runFor(20_000);
    await expect(frame(page).getByTestId("call")).toHaveText("waiting");
    await expect(question(page)).toHaveCount(0);
    await expect(section(page)).toHaveAttribute("data-responding", "responding");
  });
});
