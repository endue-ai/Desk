/**
 * Scripted brain answers for tests and fixture pages (never shipped): views a brain would propose for
 * "show my events this week as a board" over the stub's fixture events, without the parts the desk
 * writes itself (id, version, provenance).
 */

const agenda = (title: string, calendar: string, empty: string) => ({
  type: "agenda",
  title,
  range: "week",
  binding: {
    kinds: ["event"],
    sources: ["$calendar"],
    where: [{ field: "calendar", op: "eq", value: calendar }],
    sort: [{ field: "start", dir: "asc" }],
  },
  fields: [{ value: "{start|time} {title}" }, { value: "{location}" }],
  empty,
});

/** This week's events as a board: one column per calendar, and how many there are. */
export const BOARD = {
  title: "Events this week",
  description: "This week's events, one column per calendar.",
  requires: { calendar: { kinds: ["event"], title: "A calendar" } },
  layout: {
    type: "stack",
    children: [
      {
        type: "stat",
        title: "Coming up",
        binding: {
          kinds: ["event"],
          sources: ["$calendar"],
          where: [{ field: "start", op: "gte", value: "{today}" }],
        },
      },
      {
        type: "grid",
        columns: 2,
        children: [
          agenda("Work", "Work", "No work events this week."),
          agenda("Personal", "Personal", "Nothing personal this week."),
        ],
      },
    ],
  },
};

/** The same board after "only the work calendar". */
export const BOARD_WORK = {
  title: "Work this week",
  description: "This week's work events.",
  requires: BOARD.requires,
  layout: agenda("Work", "Work", "No work events this week."),
};

/**
 * The view a brain would propose for a prompt: only work after a correction that says so, the board
 * for a sentence about a board, and none otherwise.
 */
export function viewFor(prompt: string): Record<string, unknown> | undefined {
  if (/only the work calendar/i.test(prompt)) return BOARD_WORK;
  if (/as a board/i.test(prompt)) return BOARD;
  return undefined;
}

/**
 * A scripted brain for fixture pages: the view viewFor gives in a fenced block, and an echo of the
 * prompt otherwise (which is no view).
 */
export function scriptedViews(prompt: string): string {
  const view = viewFor(prompt);
  return view ? answer(view) : `I heard: ${prompt.slice(0, 200)}`;
}

const answer = (view: unknown) =>
  `Here is a view for that.\n\`\`\`json\n${JSON.stringify(view, null, 2)}\n\`\`\``;
