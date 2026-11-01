import { expect, type FrameLocator, type Page, test } from "@playwright/test";

test("the state command switches Eris between her six poses", async ({ page }) => {
  await page.goto("/onboarding.html?plugins=eris");
  await page.waitForFunction(() => window.__desk !== undefined);
  await page.evaluate(() => window.__desk.runtime.plugins?.ready);
  const frame = page.frameLocator('[data-surface="endue.eris"] iframe');
  await expect(frame.locator("#pose")).toHaveAttribute("data-state", "idle");
  for (const state of ["listening", "thinking", "done", "heads-up", "oops", "idle"]) {
    await page.evaluate(
      (s) => window.__desk.runtime.plugins?.command("endue.eris", "state", s),
      state,
    );
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", state);
    await expect(frame.locator("#pose img")).toHaveAttribute("src", `./assets/state-${state}.svg`);
  }
});

test.describe("talking to Eris", () => {
  // The fixture's brain.say answers like brain-echo on the page clock: started after 50 ms, then one
  // delta per word every 50 ms, then completed (?brain=offline: an offline event instead).
  async function open(page: Page, brain: "echo" | "offline"): Promise<FrameLocator> {
    await page.clock.install({ time: 0 });
    await page.clock.pauseAt(1000);
    await page.goto(`/onboarding.html?plugins=eris&brain=${brain}`);
    await page.waitForFunction(() => window.__desk !== undefined);
    const frame = page.frameLocator('[data-surface="endue.eris"] iframe');
    await expect(frame.getByLabel("Talk to Eris")).toBeVisible();
    return frame;
  }

  async function send(frame: FrameLocator, text: string) {
    const input = frame.getByLabel("Talk to Eris");
    await input.fill(text);
    await input.press("Enter");
  }

  test("a typed line rises into her centre and the echo streams back as soul text", async ({
    page,
  }) => {
    const frame = await open(page, "echo");
    await send(frame, "hello there");
    await expect(frame.locator(".user-rise")).toHaveText("hello there");
    await page.clock.runFor(60);
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", "thinking");
    await page.clock.runFor(60);
    await expect(frame.locator("#answer .word")).toHaveCount(1);
    await page.clock.runFor(400);
    await expect(frame.locator("#answer .word")).toHaveText(["hello", "there"]);
    await expect(frame.locator("#live p").last()).toHaveText("hello there");
    await page.clock.runFor(1500);
    await expect(frame.locator(".user-rise")).toHaveCount(0);
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", "idle");
    const said = await page.evaluate(() =>
      window.__desk.stub.log
        .filter((entry) => entry.request.method === "brain.say")
        .map((entry) => [entry.caller, entry.request.params]),
    );
    expect(said).toEqual([
      ["endue.eris", { text: "hello there", scope: { permission: "brain:converse" } }],
    ]);
  });

  test("an unreachable brain gets the offline line, and the answer follows on reconnection", async ({
    page,
  }) => {
    const frame = await open(page, "offline");
    await send(frame, "hello");
    await page.clock.runFor(100);
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", "heads-up");
    await expect(frame.locator("#live p").last()).toHaveText(
      "I can't reach endue right now. Check your connection, and I'll pick up where we left off.",
    );
    await expect(frame.getByRole("button", { name: "Send" })).toBeDisabled();
    await page.evaluate(() => {
      const turn = (kind: "online" | "started" | "delta" | "completed", text?: string) =>
        window.__desk.stub.emit({
          event: "brain.turn",
          data: { turnId: "t1", kind, ...(text === undefined ? {} : { text }) },
        });
      turn("online");
      turn("started");
      turn("delta", "hello");
      turn("completed");
    });
    await page.clock.runFor(1500);
    await expect(frame.locator("#answer .word")).toHaveText(["hello"]);
    await expect(frame.getByRole("button", { name: "Send" })).toBeEnabled();
  });

  test("turns another caller started never reach her", async ({ page }) => {
    const frame = await open(page, "echo");
    await page.evaluate(() => {
      window.__desk.stub.emit({ event: "brain.turn", data: { turnId: "t9", kind: "started" } });
      window.__desk.stub.emit({
        event: "brain.turn",
        data: { turnId: "t9", kind: "delta", text: "not yours" },
      });
    });
    await page.clock.runFor(500);
    await expect(frame.locator("#answer .word")).toHaveCount(0);
    await expect(frame.locator("#pose")).toHaveAttribute("data-state", "idle");
  });

  test("both exchanges stay readable while the composer keeps keyboard focus", async ({ page }) => {
    const frame = await open(page, "echo");
    for (const question of ["first question", "second question"]) {
      await send(frame, question);
      await page.clock.runFor(1600);
    }
    const history = frame.getByRole("region", { name: "Conversation history" });
    await expect(history.locator("article p")).toHaveText([
      "first question",
      "first question",
      "second question",
      "second question",
    ]);
    await expect(frame.getByLabel("Talk to Eris")).toBeFocused();
    await expect(frame.getByRole("button", { name: "Attach open text file" })).toBeEnabled();
    await page.locator('[data-surface="endue.eris"] iframe').evaluate((element) => {
      const iframe = element as HTMLIFrameElement;
      iframe.style.setProperty("width", "306px", "important");
      iframe.style.setProperty("height", "209px", "important");
    });
    const compact = await frame.locator("html").evaluate((root) => {
      const win = root.ownerDocument.defaultView;
      const send = root.querySelector(".send")?.getBoundingClientRect();
      if (!win || !send) return null;
      return {
        width: win.innerWidth,
        height: win.innerHeight,
        overflow: root.scrollWidth > win.innerWidth,
        sendVisible:
          send.top >= 0 && send.bottom <= win.innerHeight && send.right <= win.innerWidth,
      };
    });
    expect(compact).toEqual({ width: 306, height: 209, overflow: false, sendVisible: true });
  });
});
