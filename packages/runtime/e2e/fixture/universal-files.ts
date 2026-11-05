// Files for desk.universal on the views page (never shipped): fs.read serves the fixture board
// ~/boards/launch.yaml, fs.list the folder ~/notes; every path fs.read served is recorded, so a test
// sees that changing the shape or a field never reads the source again.
import { StubError, type StubHandlers } from "@endue-ai/bridge";

const FILES: Record<string, string> = {
  "~/boards/launch.yaml": `title: Launch
entries:
  - { id: post, name: Write the launch post, column: doing, due: 2026-10-30, owner: Mira }
  - { id: demo, name: Record the demo, column: todo, due: 2026-11-02, owner: Theo }
  - { id: notes, name: Release notes, column: todo, due: 2026-11-03 }
  - { id: site, name: Update the site, column: done, due: 2026-10-28, owner: Mira }
`,
};
const NOTES = [
  { name: "standup.md", kind: "file", size: 812, modifiedAt: "2026-10-30T08:40:00+09:00" },
  { name: "drafts", kind: "dir", modifiedAt: "2026-10-29T18:00:00+09:00" },
  { name: "q4-plan.yaml", kind: "file", size: 2300, modifiedAt: "2026-10-27T11:05:00+09:00" },
] as const;

const reads: string[] = [];
const handlers: StubHandlers = {
  "fs.read": ({ path }) => {
    const content = FILES[path];
    if (content === undefined) throw new StubError("not_found", `no such file: ${path}`);
    reads.push(path);
    return { content, encoding: "utf8", size: content.length };
  },
  "fs.list": ({ path }) => {
    if (path.replace(/\/+$/, "") !== "~/notes")
      throw new StubError("not_found", `no such folder: ${path}`);
    return { entries: NOTES.map((entry) => ({ ...entry })) };
  },
};

export const universalFiles = { handlers, reads };
