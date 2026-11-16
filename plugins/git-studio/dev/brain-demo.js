// Canned brain.ask answers for the preview's screenshots of the demo repository (?brain=demo), by
// tool name. The desk asks its real brain; nothing here ships.

export const DEMO_ANSWERS = {
  write_commit_message: {
    summary: "feat(server): log every request with a timestamp",
    body: "The server now imports log.js and writes one line for each request,\nso slow uploads can be traced. The gallery grid grows to four columns\nand its cells account for the outer gap.",
  },
  explain_commit: {
    summary:
      "Generates thumbnails in three fixed sizes (64, 256 and 1024 pixels) so album pages and the photo viewer no longer scale the originals in the browser.",
    points: [
      "Adds src/images/thumbs.js with the list of sizes",
      "The sizes match the grid cell, the album cover and the full-screen viewer",
      "No callers yet: the upload route still has to produce the files",
    ],
    risk: "low",
    riskReason: "A new module with no callers changes nothing at runtime.",
  },
  resolve_conflict: {
    lines: ['  accent: "#14b8a6",'],
    reasoning:
      "Main's teal accent is the newer design decision; the warm orange came from an older branch.",
  },
  describe_branch: {
    title: "Search photos by tag",
    body: "Adds a search route that finds photos by tag.\n\n## Changes\n- `GET /search?tag=` returns the photos with that tag\n- Results are empty until tags are stored with uploads\n\n## How to test\n1. Start the server\n2. Open `/search?tag=beach` and expect an empty list",
  },
};
