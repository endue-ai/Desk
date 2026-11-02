import { describe, expect, it } from "vitest";
import type { InstalledTheme } from "../theme";
import { filterCards, moveIn, tagsOf, themeCards } from "./model";

const theme = (id: string, name: string, tags: string[], author?: string): InstalledTheme => ({
  id,
  name,
  description: `${name} theme`,
  url: (path) => path,
  theme: { ...(author ? { author } : {}), tags, dark: {} },
});
const installed = [
  theme("endue.theme-paper", "Paper & Ink", ["light", "warm", "paper"], "Team endue"),
  theme("endue.theme-amber", "Amber CRT", ["dark", "retro"]),
];
const previewOf = (id: string, scheme: "light" | "dark") => [`${id || "endue"}-${scheme}`];

describe("the gallery's cards", () => {
  it("put the endue theme first, then every installed theme, with both schemes' colours", () => {
    const cards = themeCards(
      installed,
      { name: "endue", description: "The desk's own." },
      previewOf,
    );
    expect(cards.map((c) => c.id)).toEqual(["", "endue.theme-paper", "endue.theme-amber"]);
    expect(cards[1]).toMatchObject({
      name: "Paper & Ink",
      author: "Team endue",
      tags: ["light", "warm", "paper"],
      light: ["endue.theme-paper-light"],
      dark: ["endue.theme-paper-dark"],
    });
    expect(cards[0]?.light).toEqual(["endue-light"]);
  });

  it("filter by every word and by tag, and list each tag once", () => {
    const cards = themeCards(
      installed,
      { name: "endue", description: "The desk's own." },
      previewOf,
    );
    expect(filterCards(cards, "amber").map((c) => c.id)).toEqual(["endue.theme-amber"]);
    expect(filterCards(cards, "paper ink").map((c) => c.id)).toEqual(["endue.theme-paper"]);
    expect(filterCards(cards, "", "dark").map((c) => c.id)).toEqual(["", "endue.theme-amber"]);
    expect(filterCards(cards, "nothing like this")).toEqual([]);
    expect(tagsOf(cards)).toEqual(["light", "dark", "warm", "paper", "retro"]);
  });
});

describe("moving through the grid", () => {
  it("goes across, down by a row, and to the ends", () => {
    expect(moveIn(0, "ArrowRight", 7, 3)).toBe(1);
    expect(moveIn(0, "ArrowLeft", 7, 3)).toBe(0);
    expect(moveIn(1, "ArrowDown", 7, 3)).toBe(4);
    expect(moveIn(5, "ArrowDown", 7, 3)).toBe(5);
    expect(moveIn(4, "ArrowUp", 7, 3)).toBe(1);
    expect(moveIn(3, "End", 7, 3)).toBe(6);
    expect(moveIn(3, "Home", 7, 3)).toBe(0);
    expect(moveIn(-1, "ArrowRight", 0, 3)).toBe(-1);
  });
});
