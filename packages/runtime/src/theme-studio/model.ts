/**
 * The theme studio's gallery as data: one card for the endue theme and one per installed theme
 * plugin, what each shows (name, description, author, tags, preview colours per scheme), the filter,
 * and how the arrow keys move through a grid. DOM-free.
 */
import type { InstalledTheme } from "../theme";

export interface ThemeCard {
  /** The theme plugin's id; "" is the endue theme. */
  id: string;
  name: string;
  description: string;
  author?: string;
  tags: string[];
  /** Colours that stand for it in each scheme: background, card, primary, text. */
  light: string[];
  dark: string[];
}

/** The colours a theme shows in a scheme, from what the desk would apply. */
export type PreviewOf = (id: string, scheme: "light" | "dark") => string[];

export function themeCards(
  installed: readonly InstalledTheme[],
  endue: { name: string; description: string },
  previewOf: PreviewOf,
): ThemeCard[] {
  const card = (id: string, name: string, description: string, extra: Partial<ThemeCard> = {}) => ({
    id,
    name,
    description,
    tags: [],
    light: previewOf(id, "light"),
    dark: previewOf(id, "dark"),
    ...extra,
  });
  return [
    card("", endue.name, endue.description, { tags: ["light", "dark"] }),
    ...installed.map((t) =>
      card(t.id, t.name, t.description ?? "", {
        ...(t.theme.author ? { author: t.theme.author } : {}),
        tags: [...(t.theme.tags ?? [])],
      }),
    ),
  ];
}

/** Every tag the cards carry, once, in the order they first appear. */
export function tagsOf(cards: readonly ThemeCard[]): string[] {
  return [...new Set(cards.flatMap((c) => c.tags))];
}

/** The cards whose name, description or author holds every word of `query`, with `tag` if given. */
export function filterCards(cards: readonly ThemeCard[], query: string, tag?: string): ThemeCard[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((c) => {
    if (tag && !c.tags.includes(tag)) return false;
    const text = `${c.name} ${c.description} ${c.author ?? ""} ${c.tags.join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** Where an arrow, Home or End key moves in a grid of `count` cards, `columns` wide. */
export function moveIn(index: number, key: string, count: number, columns: number): number {
  if (count === 0) return -1;
  const last = count - 1;
  const at = Math.min(Math.max(index, 0), last);
  switch (key) {
    case "ArrowRight":
      return Math.min(at + 1, last);
    case "ArrowLeft":
      return Math.max(at - 1, 0);
    case "ArrowDown":
      return at + columns <= last ? at + columns : at;
    case "ArrowUp":
      return at - columns >= 0 ? at - columns : at;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return at;
  }
}
