// Tile and cascade undone from a terminal (ADR 0077, ADR 0116): `desk cmd run desk.windows.tile`,
// then `desk undo` and `desk redo`, as the person types them, on the CEF desk. The core checks the
// args an undo hands the inverse against what the inverse declares, which the runtime's stub does
// not: restore-arrangement refused them once, and that entry then blocked every undo after it
// (#163). Three of the shell's own windows on a fresh desktop; desk.windows.list says where each is.
import { expect } from "@wdio/globals";
import { deskOk } from "../support/cli";
import { shellReady } from "../support/desk";
import {
  clearDesk,
  closeShellWindows,
  type Desk,
  deskNow,
  freshDesktop,
  onScreen,
  openWindow,
  type Rect,
  rectOf,
  until,
} from "../support/windows";

type Rects = Record<string, Rect>;

const rects = (desk: Desk): Rects =>
  Object.fromEntries(onScreen(desk).map((w) => [w.id, rectOf(w)]));
const same = (a: Rects, b: Rects) => JSON.stringify(a) === JSON.stringify(b);
/** What `desk undo` and `desk redo` print: the entry's command and caller, then when it ran. */
const undone = (out: string) => out.trim().split("\t").slice(0, 2);

describe("tile and cascade undone from the CLI (#163)", () => {
  before(async () => {
    await shellReady();
    await clearDesk();
  });
  beforeEach(async () => {
    await freshDesktop();
  });
  afterEach(async () => {
    await closeShellWindows();
  });

  for (const kind of ["tile", "cascade"]) {
    const command = `desk.windows.${kind}`;
    it(`desk undo puts the windows back after ${command}; desk redo arranges them again`, async () => {
      for (let n = 0; n < 3; n++) await openWindow();
      const before = rects(await deskNow());
      expect(Object.keys(before)).toHaveLength(3);
      deskOk(["cmd", "run", command]);
      const arranged = rects(await until((d) => !same(rects(d), before), `${kind} moved them`));

      expect(undone(deskOk(["undo"]))).toEqual([command, "cli"]);
      await until((d) => same(rects(d), before), "the undo put them back");
      expect(undone(deskOk(["redo"]))).toEqual([command, "cli"]);
      await until((d) => same(rects(d), arranged), "the redo arranged them again");
      expect(undone(deskOk(["undo"]))).toEqual([command, "cli"]);
      await until((d) => same(rects(d), before), "and the next undo took that back");
    });
  }
});
