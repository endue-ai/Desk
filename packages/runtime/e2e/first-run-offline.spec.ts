import { expect, test } from "@playwright/test";
import {
  accountCalls,
  answer,
  answerMicrophone,
  brainCalls,
  NOT_NOW,
  open,
  run,
  skip,
  stored,
  until,
  untilScene,
} from "./first-run";

test("a fresh desk can finish setup offline after trying to create an account", async ({
  page,
  context,
}) => {
  const frame = await open(page);
  await run(page, 1500);
  await frame.getByRole("button", { name: "Skip intro" }).click();
  const create = frame.getByRole("button", { name: "Create account" });
  await until(page, create);
  await context.setOffline(true);
  await create.click();
  const local = frame.getByRole("button", { name: "Continue offline" });
  await expect(local).toBeFocused();
  await local.press("Enter");
  const later = frame.getByRole("button", { name: "Later" });
  await until(page, later);
  await later.click();
  await answerMicrophone(page, frame, NOT_NOW);
  await answer(page, frame, "Type your name", "Ada");
  await untilScene(page, frame, "task");
  await answer(page, frame, "Type a task", "Find time for a walk");
  const example = frame.getByRole("button", { name: "Plan my week" });
  await expect(example).toBeFocused();
  await example.press("Enter");
  await until(page, frame.getByRole("button", { name: "Not now" }));
  await expect(frame.getByRole("heading", { name: "This week" })).toBeVisible();
  await frame.getByRole("button", { name: "Not now" }).click();
  await untilScene(page, frame, "outro");
  await skip(page, 20_000);
  await expect
    .poll(() => stored(page, "first-run"))
    .toMatchObject({
      done: true,
      name: "Ada",
      local: true,
      listening: false,
    });
  await skip(page, 1000);
  await expect(page.locator('[data-surface="endue.onboarding"]')).toHaveCount(0);
  expect((await accountCalls(page)).map((call) => call.method)).toEqual(["account.status"]);
  expect(await brainCalls(page)).toBe(0);
});

test("reconnecting sends the waiting first task once", async ({ page, context }) => {
  const frame = await open(page, "?resume=task&name=Ada");
  await untilScene(page, frame, "task");
  await context.setOffline(true);
  await answer(page, frame, "Type a task", "Find time for a walk");
  await expect(frame.getByRole("button", { name: "Plan my week" })).toBeFocused();
  expect(await brainCalls(page)).toBe(0);
  await context.setOffline(false);
  await expect.poll(() => brainCalls(page)).toBe(1);
  await run(page, 3000);
  await expect(frame.locator("#canvas .answer .body")).toHaveText("Find time for a walk");
  await expect(frame.getByRole("button", { name: "Plan my week" })).toHaveCount(0);
});

test("reconnecting after choosing an offline example keeps that screen", async ({
  page,
  context,
}) => {
  const frame = await open(page, "?resume=task&name=Ada&connect=folder");
  await untilScene(page, frame, "task");
  await context.setOffline(true);
  await answer(page, frame, "Type a task", "Find time for a walk");
  const folder = frame.getByRole("button", { name: "Summarize this folder" });
  await expect(folder).toBeVisible();
  await folder.click();
  await context.setOffline(false);
  await untilScene(page, frame, "layout");
  await expect(frame.getByRole("heading", { name: "Documents" })).toBeVisible();
  expect(await brainCalls(page)).toBe(0);
});
