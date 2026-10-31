import { beforeEach, describe, expect, it, vi } from "vitest";
// Before the elements: it installs the DOM they extend.
import "./test-dom";
import { defineElements } from "./index";
import { focused, press, queryAll, reset } from "./test-dom";

defineElements();

const at = (time: string) => `2026-10-30T${time}:00+09:00`;
const events = [
  { title: "Design review", start: at("16:00"), end: at("17:00"), detail: "Room 1" },
  { title: "Team standup", start: at("08:30"), end: at("08:45") },
  { title: "Lunch with Mina", start: at("12:30"), end: at("13:30"), detail: "Bistro Seoul" },
  { title: "Holiday", start: "2026-10-30T00:00:00+09:00", end: at("23:59"), allDay: true },
  { title: "Coffee", start: at("08:00"), end: at("09:30") },
];

function agenda(now = at("09:00")) {
  const element = document.createElement("desk-agenda");
  element.setAttribute("label", "Schedule");
  element.setAttribute("time-zone", "Asia/Seoul");
  element.setAttribute("now", now);
  element.events = events;
  document.body.append(element);
  const root = element.shadowRoot as unknown as Element;
  const [list] = queryAll(root, (el) => el.getAttribute("role") === "listbox");
  const children = () => [...(list as HTMLElement).children] as HTMLElement[];
  const options = () => children().filter((el) => el.getAttribute("role") === "option");
  const text = (option: Element, part: string) =>
    queryAll(option, (el) => el.getAttribute("class") === part)[0]?.textContent;
  return { element, list: list as HTMLElement, children, options, text };
}

describe("desk-agenda", () => {
  beforeEach(reset);

  it("lists all-day events first, then timed ones by start, with times in its time-zone", () => {
    const { list, options, text } = agenda();
    expect(list.getAttribute("aria-label")).toBe("Schedule");
    expect(options().map((option) => text(option, "title"))).toEqual([
      "Holiday",
      "Coffee",
      "Team standup",
      "Lunch with Mina",
      "Design review",
    ]);
    expect(options().map((option) => text(option, "time"))).toEqual([
      "All day",
      "08:00",
      "08:30",
      "12:30",
      "16:00",
    ]);
    expect(text(options()[3] as Element, "detail")).toBe("Bistro Seoul");
    expect(options()[0]?.hasAttribute("data-all-day")).toBe(true);
  });

  it("draws the now-line between past and upcoming events and marks past ones", () => {
    const { element, children, options } = agenda();
    const line = () => children().filter((el) => el.getAttribute("role") === "separator");
    expect(line()).toHaveLength(1);
    expect(line()[0]?.getAttribute("aria-label")).toBe("Now, 09:00");
    // After the standup (08:30) and before lunch (12:30): Coffee is still on, the standup is over.
    const titles = children().map(
      (el) => el.getAttribute("role") === "separator" || el.textContent,
    );
    expect(titles.indexOf(true)).toBe(3);
    expect(options().map((option) => option.hasAttribute("data-past"))).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);

    element.setAttribute("now", at("14:00"));
    expect(line()).toHaveLength(1);
    expect(line()[0]?.getAttribute("aria-label")).toBe("Now, 14:00");
    expect(children().findIndex((el) => el.getAttribute("role") === "separator")).toBe(4);
    expect(options().map((option) => option.hasAttribute("data-past"))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it("moves and selects like desk-list", () => {
    const { element, list, options } = agenda();
    const onSelect = vi.fn();
    element.addEventListener("desk-select", onSelect);
    element.focus();
    expect(focused()).toBe(list);
    press("ArrowDown");
    press("ArrowDown");
    expect(list.getAttribute("aria-activedescendant")).toBe(options()[1]?.id);
    press("End");
    expect(list.getAttribute("aria-activedescendant")).toBe(options()[4]?.id);
    press("ArrowUp");
    expect(press("Enter")).toBe(true);
    expect(onSelect.mock.calls[0]?.[0].detail).toEqual({ index: 3, event: events[2] });
    expect(element.selectedIndex).toBe(3);
    expect(options()[3]?.getAttribute("aria-selected")).toBe("true");
    options()[0]?.click();
    expect(onSelect.mock.calls[1]?.[0].detail).toEqual({ index: 0, event: events[3] });
  });
});
