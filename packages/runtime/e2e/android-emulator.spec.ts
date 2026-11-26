import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 900 } });

test("open the emulator, use its screen and replay device conditions", async ({ page }) => {
  await page.goto("/android-emulator.html");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  await page.evaluate(() =>
    window.__desk.runtime.commands.run("desk.plugins.open", { plugin: "endue.android-emulator" }),
  );
  const surface = page.locator('[data-surface="endue.android-emulator"]');
  await surface.evaluate((el: HTMLElement) => {
    el.style.flexBasis = "882px";
    el.style.height = "750px";
  });
  const iframe = surface.locator("iframe");
  const frame = iframe.contentFrame();
  await expect(frame.getByRole("button", { name: "Refresh devices" })).toBeVisible();
  const idle = await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.android-emulator.state", {}),
  );
  expect(idle).toMatchObject({ phase: "idle", devices: [], session: null });
  expect(await page.evaluate(() => window.__desk.commands)).toEqual([]);
  await frame.getByRole("button", { name: "Refresh devices" }).click();
  await expect(frame.locator("#device option")).toHaveCount(2);
  await frame.getByRole("button", { name: "Connect", exact: true }).click();
  const screen = frame.locator("#display");
  await expect(screen).toBeVisible();
  const current = (await page.evaluate(() =>
    window.__desk.runtime.commands.run("endue.android-emulator.state", {}),
  )) as { session: { id: string } };
  expect(current).toMatchObject({ phase: "connected", preview: { drawn: true, paused: false } });
  await expect(
    page.evaluate(() =>
      window.__desk.runtime.commands.run("endue.android-emulator.operate", {
        session: "expired-connection",
        action: "key",
        key: "Home",
      }),
    ),
  ).rejects.toThrow("That emulator session changed");
  await expect(
    page.evaluate(
      (session) =>
        window.__desk.runtime.commands.run("endue.android-emulator.operate", {
          session,
          action: "key",
          key: "Home",
        }),
      current.session.id,
    ),
  ).resolves.toMatchObject({ result: "Sent the key." });
  expect(await page.evaluate(() => window.__desk.commands)).toContainEqual(
    expect.stringMatching(/-t 12 shell input keyevent 3$/),
  );
  const center = await screen.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.floor(r.width / 2), y: Math.floor(r.height / 2) };
  });
  await screen.click({ position: center });
  await screen.press("Escape");
  await expect
    .poll(() =>
      page.evaluate(() => window.__desk.commands.filter((c) => c.includes("shell input"))),
    )
    .toContainEqual(expect.stringMatching(/input tap (49|50) (99|100)$/));
  await expect
    .poll(() =>
      page.evaluate(() => window.__desk.commands.some((c) => c.endsWith("input keyevent 4"))),
    )
    .toBe(true);
  const paused = await page.evaluate(
    (session) =>
      window.__desk.runtime.commands.run("endue.android-emulator.pause-preview", { session }),
    current.session.id,
  );
  expect(paused).toMatchObject({ preview: { paused: true } });
  await expect(frame.getByRole("button", { name: "Resume preview" })).toBeVisible();
  await frame
    .getByRole("combobox", { name: "Preset", exact: true })
    .selectOption("Low battery on EDGE");
  await frame.getByLabel("Preset name").fill("Travel");
  await frame.getByRole("button", { name: "Save preset" }).click();
  await expect(frame.locator("#feedback")).toHaveText("Saved preset Travel.");
  await frame.getByRole("button", { name: "Apply conditions" }).click();
  await expect(frame.locator("#feedback")).toHaveText("Applied 4 device changes.");
  await frame.getByRole("button", { name: "Apps", exact: true }).click();
  await expect(frame.getByRole("combobox", { name: "Installed user apps" })).toHaveValue(
    "demo.notes",
  );
  await frame.getByRole("button", { name: "Read memory" }).click();
  await expect(frame.locator("#app-output")).toContainText("TOTAL PSS: 4218");
  await frame.getByRole("button", { name: "Device", exact: true }).click();
  await expect(frame.getByRole("combobox", { name: "Saved snapshots" })).toHaveValue("baseline");
  await frame.getByRole("button", { name: "Restore…" }).click();
  await frame.getByRole("button", { name: "Cancel" }).click();
  expect(
    await page.evaluate(() => window.__desk.commands.some((c) => c.includes("snapshot load"))),
  ).toBe(false);
  await frame.getByRole("button", { name: "Logcat", exact: true }).click();
  await frame.getByRole("button", { name: "Read logcat" }).click();
  await frame.getByLabel("Filter text").fill("TestApp");
  await expect(frame.locator("#log-output")).toHaveText("I TestApp: Started");
  await surface.evaluate((el: HTMLElement) => {
    el.style.flexBasis = "362px";
  });
  for (const [command, attribute, value] of [
    ["desk.theme.light", "data-scheme", "light"],
    ["desk.theme.dark", "data-scheme", "dark"],
    ["desk.theme.contrast", "data-contrast", "high"],
    ["desk.theme.motion", "data-motion", "reduce"],
  ] as const) {
    await page.evaluate((c) => window.__desk.runtime.commands.run(c), command);
    await expect(frame.locator("html")).toHaveAttribute(attribute, value);
    expect(await frame.locator("html").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  }
  await frame.getByRole("button", { name: "Disconnect" }).click();
  await expect(screen).toBeHidden();
  await expect(frame.getByRole("button", { name: "Read logcat" })).toBeDisabled();
});
