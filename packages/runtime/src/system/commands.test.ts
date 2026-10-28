import { expect, test } from "vitest";
import { type Command, match } from "./commands";

const command = (id: string, label: string, keywords: string[], palette = true): Command => ({
  id,
  label,
  keywords,
  palette,
  run: () => undefined,
});

const list = [
  command("window.new", "표면 · 새 표면", ["new", "window", "새", "표면"]),
  command("open.calendar", "열기 · 캘린더", ["calendar", "캘린더"]),
  command("mode.night", "모드 · Night", ["Night", "night"]),
  command("ui.dismiss", "팝오버와 입력 닫기", ["dismiss"], false),
];

test("keywords that start with the query come first, then keywords or labels that contain it", () => {
  expect(match(list, "cal").map((c) => c.id)).toEqual(["open.calendar"]);
  expect(match(list, "새 표면").map((c) => c.id)).toEqual(["window.new"]);
  expect(match(list, "ight").map((c) => c.id)).toEqual(["mode.night"]);
});

test("commands bound to keys only stay out of the palette", () => {
  expect(match(list, "dismiss")).toEqual([]);
  expect(match(list, "   ")).toEqual([]);
});
