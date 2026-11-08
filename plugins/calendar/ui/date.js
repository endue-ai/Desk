// Days from words, and asking the person for one through the palette.
import { DAY } from "./ical/values.js";

/** A day from words: 2026-11-03, 2026-11, today, tomorrow, yesterday. */
export function dayFrom(/** @type {string} */ words, /** @type {number} */ today) {
  const text = words.trim().toLowerCase();
  const relative = { today: 0, tomorrow: 1, yesterday: -1 }[text];
  if (relative !== undefined) return today + relative;
  const match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3] ?? 1);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return undefined;
  return Math.floor(date.getTime() / DAY);
}

/**
 * The day the person names: `given` words, or the palette's answer to "Go to a date". Resolves
 * undefined when they name nothing (or cancel), and fails on words that are not a date.
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands">} ctx
 * @param {unknown} given
 * @param {number} today
 */
export async function askDay({ commands }, given, today) {
  const words =
    typeof given === "string"
      ? given
      : await commands
          .run("desk.palette.pick", {
            title: "Go to a date",
            items: [
              { id: "today", label: "Today" },
              { id: "tomorrow", label: "Tomorrow" },
            ],
            free: true,
            placeholder: "2026-11-03",
          })
          .catch((error) => {
            if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") return null;
            throw error;
          });
  if (typeof words !== "string" || words === "") return undefined;
  const day = dayFrom(words, today);
  if (day === undefined) throw new Error(`"${words}" is not a date; write it as 2026-11-03.`);
  return day;
}
