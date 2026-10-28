// The screens Eris builds in scene 8: tomorrow's schedule with its overlap, a folder summary, an empty
// week to fill in together (sample data, samples.js), or a panel for anything else, filled by the brain.
import { element } from "./director.js";
import { CALENDAR, FOLDER, findOverlap, WEEK } from "./samples.js";

function panel(className, title) {
  const section = element("section", `panel ${className}`);
  section.append(element("h2", "", title));
  return section;
}

/** One event of the schedule: its times and its title. */
export function row(event) {
  const item = element("li");
  item.dataset.title = event.title;
  item.append(element("time", "", `${event.start}-${event.end}`), element("span", "", event.title));
  return item;
}

export function tomorrow() {
  const schedule = panel("schedule", CALENDAR.day);
  const list = element("ol");
  const events = CALENDAR.events.map((event) => ({ ...event }));
  for (const event of events) list.append(row(event));
  schedule.append(list);
  const overlap = findOverlap(events);
  const panels = [schedule];
  if (overlap) {
    const [first, second] = overlap;
    const card = panel("overlap", "Overlap");
    card.append(
      element("p", "", `${first.start} ${first.title} and ${second.start} ${second.title}`),
    );
    panels.push(card);
  }
  return { panels, overlap, list };
}

export function folder() {
  const summary = panel("folder", FOLDER.name);
  summary.append(
    element("p", "", `${FOLDER.files} files, ${FOLDER.changed.length} changed this week`),
  );
  const list = element("ul");
  for (const file of FOLDER.changed) {
    const item = element("li");
    item.append(element("span", "", file.name), element("time", "", file.when));
    list.append(item);
  }
  summary.append(list);
  return { panels: [summary] };
}

export function week() {
  const board = panel("week", "This week");
  const days = element("div", "days");
  for (const day of WEEK) {
    const column = element("div", "day");
    column.append(element("h3", "", day), element("div", "empty"));
    days.append(column);
  }
  board.append(days);
  return { panels: [board] };
}

/** Anything else: the request as the title, the brain's answer as it streams in. */
export function answer(text) {
  const reply = panel("answer", text.length > 60 ? `${text.slice(0, 57)}...` : text);
  const body = element("p", "body");
  reply.append(body);
  return { panels: [reply], body };
}
