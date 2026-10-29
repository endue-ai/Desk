import { expect, test } from "vitest";
import type { CommandInfo } from "../commands";
import { match, segment } from "./commands";

const command = (id: string, title: string, keywords: string[]): CommandInfo => ({
  id,
  title,
  keywords,
  provider: "desk",
});

const list = [
  command("desk.display.new-surface", "표면 · 새 표면", ["new", "window", "새", "표면"]),
  command("desk.shell.open-calendar", "열기 · 캘린더", ["calendar", "캘린더"]),
  command("desk.shell.profile-night", "프로필 · Night", ["Night", "night"]),
  command("desk.keys.quit", "Quit what is in progress", ["cancel", "escape"]),
];

test("keywords that start with the query come first, then keywords or titles that contain it", () => {
  expect(match(list, "cal").map((c) => c.id)).toEqual(["desk.shell.open-calendar"]);
  expect(match(list, "새 표면").map((c) => c.id)).toEqual(["desk.display.new-surface"]);
  expect(match(list, "ight").map((c) => c.id)).toEqual(["desk.shell.profile-night"]);
  expect(match(list, "   ")).toEqual([]);
});

test("profile ids and agent slugs make valid command ids", () => {
  expect(segment("deep-work")).toBe("deep-work");
  expect(segment("My_desk.v2")).toBe("my-desk-v2");
});
