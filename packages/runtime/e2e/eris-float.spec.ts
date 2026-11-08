import { fileURLToPath } from "node:url";
import type { BrowserStub } from "@endue-ai/bridge";
import { expect, type Page, test } from "@playwright/test";
import { openShell, step } from "./shell-helpers";
import { shellTree } from "./shell-tree";

// The floating Eris window's view (index.html?view=eris in the app, ADR 0121, #546) on the browser
// bridge stub: the shell fixture brings the theme and the shell's sheets, the app's own sheet is
// added, and the view is mounted alone at the window's open size with the fixture's manual clock.
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const SHEET = here("../../../apps/desk/src/eris-window.css");
const MODULES = {
  view: `/@fs${here("../src/eris/float-view.ts")}`,
  float: `/@fs${here("../src/eris/float.ts")}`,
  bridge: `/@fs${here("../../bridge/src/index.ts")}`,
};

declare global {
  interface Window {
    /** This spec's floating view: what it asked of its window, and the desk's end of the link. */
    __float: {
      calls: string[];
      stub: BrowserStub;
      desk: { write(key: string, text: string): void; read(key: string): string | null };
    };
  }
}

test.use({ viewport: { width: 360, height: 520 } });

async function mountFloat(page: Page): Promise<void> {
  await openShell(page, "?lang=en");
  await page.addStyleTag({ path: SHEET });
  await page.evaluate(async (modules) => {
    const [{ mountErisFloat }, { pairedChannels }, { BridgeClient, browserStub }] =
      await Promise.all([import(modules.view), import(modules.float), import(modules.bridge)]);
    const shell = document.getElementById("desk");
    if (shell) shell.style.display = "none";
    const root = document.createElement("div");
    root.id = "eris-float-root";
    root.style.cssText = "position: fixed; inset: 0;";
    document.body.append(root);
    const calls: string[] = [];
    const stub = browserStub({ "brain.say": () => ({ turnId: "t-e2e" }) });
    const [desk, floating] = pairedChannels();
    window.__float = { calls, stub, desk };
    mountErisFloat(root, {
      core: new BridgeClient(stub),
      channel: floating,
      clock: window.__shell.clock,
      lang: "en",
      shortcut: () => ({ combo: "Alt+Enter", label: "⌥↩" }),
      reduced: () => false,
      dismiss: () => calls.push("dismiss"),
      expand: (open: boolean) => calls.push(`expand ${open}`),
      reveal: () => calls.push("reveal"),
      drag: () => calls.push("drag"),
    });
  }, MODULES);
  await step(page, 500);
}

const calls = (page: Page) => page.evaluate(() => window.__float.calls);

test("the floating Eris folded to her figure and her status", async ({ page }) => {
  await mountFloat(page);
  await expect(page.locator(".eris-float")).toHaveAttribute("data-status", "idle");
  await expect(page.locator(".eris-float-status")).toHaveText("Ready");
  await expect(page.locator(".eris-float-panel")).toBeHidden();
  expect(await shellTree(page, ".eris-float")).toMatchSnapshot("float-folded.json");
});

test("her composer talks to the desk's one conversation on the stub", async ({ page }) => {
  await mountFloat(page);
  await page.locator(".eris-float-figure").click();
  await expect(page.locator(".eris-float-input")).toBeFocused();
  expect(await calls(page)).toEqual(["expand true"]);
  await page.keyboard.type("What is next?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".eris-float")).toHaveAttribute("data-status", "thinking");
  // brain.say for the desk itself: no plugin caller, so it is the desk's conversation.
  const asked = await page.evaluate(() =>
    window.__float.stub.log
      .filter((entry) => entry.request.method === "brain.say")
      .map((entry) => ({ caller: entry.caller ?? null, params: entry.request.params })),
  );
  expect(asked).toEqual([
    {
      caller: null,
      params: { text: "What is next?", scope: { permission: "brain:converse" } },
    },
  ]);
  await page.evaluate(() => {
    const { stub } = window.__float;
    stub.emit({ event: "brain.turn", data: { turnId: "t-e2e", kind: "started" } });
    stub.emit({ event: "brain.turn", data: { turnId: "t-e2e", kind: "delta", text: "Lunch " } });
    stub.emit({ event: "brain.turn", data: { turnId: "t-e2e", kind: "delta", text: "at one." } });
    stub.emit({ event: "brain.turn", data: { turnId: "t-e2e", kind: "completed" } });
  });
  await expect(page.locator(".eris-float-line")).toHaveCount(2);
  await expect(page.locator(".eris-float")).toHaveAttribute("data-status", "speaking");
  // What was said here goes back to the desk.
  const back = await page.evaluate(() => window.__float.desk.read("desk.eris.float.back"));
  expect(JSON.parse(back ?? "{}")).toMatchObject({
    line: { who: "eris", text: "Lunch at one." },
    said: "Lunch at one.",
    state: "idle",
  });
  await step(page, 300);
  expect(await shellTree(page, ".eris-float")).toMatchSnapshot("float-open.json");
  await page.keyboard.press("Escape");
  await expect(page.locator(".eris-float-panel")).toBeHidden();
  expect(await calls(page)).toEqual(["expand true", "dismiss"]);
});

test("she shows the desk's state and an approval waiting there", async ({ page }) => {
  await mountFloat(page);
  await page.evaluate(() =>
    window.__float.desk.write(
      "desk.eris.float",
      JSON.stringify({ v: 1, seq: 1, state: "thinking", talk: "off", saying: "", lines: [] }),
    ),
  );
  await step(page, 500);
  await expect(page.locator(".eris-float")).toHaveAttribute("data-status", "thinking");
  await expect(page.locator(".eris-float-figure")).toHaveAttribute("data-state", "thinking");
  await page.evaluate(() =>
    window.__float.stub.emit({
      event: "perm.approval",
      data: {
        approvalId: "a-1",
        caller: "agent:writer",
        action: "fs.write",
        permission: { permission: "fs:write", paths: ["~/notes/**"] },
        target: "~/notes/plan.md",
      },
    }),
  );
  await page.locator(".eris-float-figure").press("Enter");
  await expect(page.locator(".eris-float-approval")).toBeVisible();
  await step(page, 500);
  expect(await shellTree(page, ".eris-float")).toMatchSnapshot("float-approval.json");
  await page.getByRole("button", { name: "Open Desk" }).click();
  expect(await calls(page)).toEqual(["expand true", "reveal"]);
});
