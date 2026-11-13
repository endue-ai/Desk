// Several file windows on the motion gate's desk (`--open`, ADR 0212, #259): three images, two notes
// and two data files, each opened in a window of its own through the desk socket as `desk files open`
// does. The shaken window is brought back to the front, so the shake still grips its title bar.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { shell, until } from "./devtools.ts";
import type { MotionDesk, Stats, WindowAt } from "./motion-desk.ts";
import { DeskSocket, socketPath } from "./socket.ts";

const IMAGES = ["large.jpg", "grey.jpg", "exif.png"];
const TEXT: Record<string, string> = {
  "one.md": "# One\n\nThe first note.\n",
  "two.md": "# Two\n\nThe second note.\n",
  "one.json": '{ "rows": [1, 2, 3] }\n',
  "two.yaml": "rows:\n  - 1\n  - 2\n",
};
/** How many windows each opener has once every file is open. */
const WANTED: Record<string, number> = { "endue.images": 3, "endue.notes": 2, "endue.data": 2 };

const pluginOf = (id: string) => id.replace(/@[1-9][0-9]*$/, "");

/** Open the files under `home`, wait for their windows' pages, bring `front` forward; their ids. */
export async function openFiles(run: MotionDesk, root: string, front: string): Promise<string[]> {
  const folder = join(run.home, "Documents", "motion");
  mkdirSync(folder, { recursive: true });
  for (const name of IMAGES)
    copyFileSync(join(root, "plugins/images/tests/fixtures", name), join(folder, name));
  for (const [name, text] of Object.entries(TEXT)) writeFileSync(join(folder, name), text);
  const desk = await DeskSocket.connect(socketPath(run.home));
  try {
    desk.answerPrompts();
    for (const name of [...IMAGES, ...Object.keys(TEXT)])
      await desk.run("desk.files.open", { path: join(folder, name) });
    const opened = await until(60_000, async () => {
      const stats: Stats = await shell(run.port, "compositor_stats");
      const ids = ((stats.windows ?? []) as WindowAt[]).map((w) => w.id);
      const of = (plugin: string) => ids.filter((id) => pluginOf(id) === plugin);
      if (Object.entries(WANTED).some(([plugin, n]) => of(plugin).length < n)) return undefined;
      const mine = Object.keys(WANTED).flatMap(of);
      const painted = (id: string) => stats.pages?.[`window:${id}`]?.texture;
      return mine.every(painted) ? mine : undefined;
    });
    if (!opened) throw new Error("the opened files' windows did not paint within 60 s");
    await desk.run("desk.windows.focus", { window: front });
    return opened;
  } finally {
    desk.close();
  }
}
