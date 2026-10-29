// Sample data behind the stubbed folder picker and connectors, until they reach the real ones. No DOM.

export const CALENDAR = {
  day: "Tomorrow",
  events: [
    { start: "09:00", end: "09:15", title: "Stand-up" },
    { start: "10:00", end: "11:00", title: "Design review" },
    { start: "10:30", end: "11:00", title: "Call with Sam" },
    { start: "14:00", end: "16:00", title: "Focus time" },
  ],
};

export const FOLDER = {
  name: "Documents",
  files: 128,
  changed: [
    { name: "Launch checklist.md", when: "this morning" },
    { name: "Q4 plan.md", when: "yesterday" },
    { name: "Pricing notes.txt", when: "2 days ago" },
  ],
};

export const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const minutes = (time) => {
  const [hours = 0, mins = 0] = time.split(":").map(Number);
  return hours * 60 + mins;
};

const clock = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;

/** The first two events that overlap, earlier first, or null when the day is clear. */
export function findOverlap(events) {
  const sorted = [...events].sort((a, b) => minutes(a.start) - minutes(b.start));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [first, second] = [sorted[i], sorted[j]];
      if (first && second && minutes(second.start) < minutes(first.end)) return [first, second];
    }
  }
  return null;
}

/** `event` moved to start when `before` ends, keeping its length. */
export function moveAfter(event, before) {
  const length = minutes(event.end) - minutes(event.start);
  const start = minutes(before.end);
  return { ...event, start: clock(start), end: clock(start + length) };
}
