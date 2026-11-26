// The registry query is shared by the Hub view and the read-only command.
import { jsonLines } from "./parse.js";

/** @param {import("./studio.js").App["docker"]} docker @param {unknown} query */
export async function searchImages(docker, query) {
  const term = typeof query === "string" ? query.trim() : "";
  if (term.length < 2 || term.length > 255 || term.includes("\0")) {
    throw new Error("Give a registry search of 2 to 255 characters.");
  }
  const { stdout } = await docker(
    ["search", "--limit", "40", "--format", "{{json .}}", "--", term],
    { timeoutMs: 20_000 },
  );
  return jsonLines(stdout)
    .slice(0, 40)
    .map((row) => ({
      name: String(row.Name ?? ""),
      description: String(row.Description ?? "").slice(0, 1000),
      official: row.IsOfficial === true || row.IsOfficial === "true",
      stars: Number(row.StarCount ?? 0),
    }))
    .sort((a, b) => Number(b.official) - Number(a.official) || b.stars - a.stars);
}
