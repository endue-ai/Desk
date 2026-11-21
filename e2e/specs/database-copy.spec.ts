// A copy from endue.database reaches the system clipboard when the person asks for it in the
// palette (#504, ADR 0318). The palette runs the command in another page, so the plugin's page has
// no key or press of its own to write with: the shell gives it one for a command the palette runs or
// a question it answers, and lends it the focus when another window is in use. A clipboard call
// the person did not start is refused at once, never left hanging. A copy past 100,000 cells asks
// first in the palette. Every check reads the clipboard back through a paste in the plugin's page
// (Mod+V, whose event carries the text and the HTML the clipboard holds) and, on macOS, `pbpaste`
// too. The keys are winit's, fed to the compositor (support/compositor.ts); the plugin opens a
// SQLite file the spec writes with `sqlite3`, and is skipped where there is none.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { click, feed, keyPress, pointIn } from "../support/compositor";
import { inFrame, press, shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";
import { byId, clearDesk, deskNow, run, windowUntil } from "../support/windows";

const DATABASE = "endue.database";
const HOST = "main.endue-database";
const PALETTE = "desk.palette";
const HELLO = "e2e.hello";
const mac = process.platform === "darwin";
const MOD: Record<string, boolean> = mac ? { meta: true } : { ctrl: true };
const PEOPLE_TSV = "1\tAda\tone\n2\tBob\t\\N";
// The table's rows as a paste reads them: Chromium writes the table into a page of its own (with
// a tbody), so the rows are what must come back as written.
const PEOPLE_ROWS =
  "<tr><td>1</td><td>Ada</td><td>one</td></tr><tr><td>2</td><td>Bob</td><td></td></tr>";
const has = (program: string) => {
  try {
    execFileSync(program, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const chord = (mods: Record<string, boolean>, key: string, code: string) =>
  feed([{ type: "modifiers", ...mods }, ...keyPress(key, code, key), { type: "modifiers" }]);
const enter = () => feed(keyPress("Enter", "Enter", "\r"));
async function type(text: string) {
  for (const ch of text) {
    const code = ch === " " ? "Space" : `Key${ch.toUpperCase()}`;
    await feed(keyPress(ch, code, ch));
    await browser.pause(15);
  }
}

/** The palette's question and its first rows. */
const palette = () =>
  inFrame(PALETTE, () =>
    browser.execute(() => ({
      title: document.querySelector("[data-testid=title]")?.textContent ?? "",
      rows: [...document.querySelectorAll("[role=option] .label")].map((r) => r.textContent),
    })),
  );

async function paletteAsks(title: string) {
  await browser.waitUntil(async () => (await palette()).title === title, {
    timeout: 10_000,
    timeoutMsg: `the palette never asked "${title}"`,
  });
}

/** Mod+K, the command picked by its words, then each answer typed and picked in turn. */
async function fromPalette(words: string, ...answers: Array<[title: string, typed: string]>) {
  await chord(MOD, "k", "KeyK");
  await paletteAsks("Search Desk");
  await type(words);
  await browser.waitUntil(async () => (await palette()).rows[0] === `Database: ${words}`, {
    timeout: 10_000,
    timeoutMsg: `the palette never offered "${words}"`,
  });
  await enter();
  for (const [title, typed] of answers) {
    await paletteAsks(title);
    await type(typed);
    await browser.pause(300);
    await enter();
  }
}

const status = () => inFrame(DATABASE, () => $("#status").getText());
const cells = () =>
  inFrame(DATABASE, () =>
    browser.execute(() => document.querySelectorAll("#result [role=gridcell]").length),
  );
async function says(text: string) {
  await browser.waitUntil(async () => (await status()) === text, {
    timeout: 10_000,
    timeoutMsg: `the status line never said "${text}"`,
  });
}

/** A point of the plugin's page in the window: the middle of `selector`'s box, once in sight. */
async function spot(selector: string): Promise<[number, number]> {
  let at: [number, number] | undefined;
  let middle: unknown;
  await browser
    .waitUntil(
      async () => {
        middle = await inFrame(DATABASE, () =>
          browser.execute((s: string) => {
            const r = document.querySelector(s)?.getBoundingClientRect();
            return r?.width ? [r.left + r.width / 2, r.top + r.height / 2] : null;
          }, selector),
        );
        at = middle ? await pointIn(HOST, middle as [number, number]) : undefined;
        return at !== undefined;
      },
      { timeout: 5_000, interval: 250 },
    )
    .catch(() => undefined);
  if (!at) throw new Error(`${selector} is not in sight (${JSON.stringify(middle)})`);
  return at;
}

/** Make `plugin`'s window the one in use. */
async function inUse(plugin: string) {
  await browser.waitUntil(
    async () => {
      await run("desk.display.show", { plugin });
      return byId(await deskNow(), plugin)?.focused === true;
    },
    { timeout: 15_000, interval: 300, timeoutMsg: `${plugin} is not shown and in use` },
  );
}

/** What a paste in the plugin's grid reads: Mod+V, its event caught before the plugin's. */
async function pasted(): Promise<{ text: string; html: string }> {
  await inUse(DATABASE);
  await click(await spot("#result [role=gridcell]"));
  await inFrame(DATABASE, () =>
    browser.execute(() => {
      const w = window as unknown as { e2ePaste?: unknown };
      w.e2ePaste = undefined;
      const caught = (e: ClipboardEvent) => {
        w.e2ePaste = {
          text: e.clipboardData?.getData("text/plain") ?? "",
          html: e.clipboardData?.getData("text/html") ?? "",
        };
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      window.addEventListener("paste", caught, { capture: true, once: true });
    }),
  );
  await chord(MOD, "v", "KeyV");
  let got: { text: string; html: string } | undefined;
  await browser.waitUntil(
    async () => {
      got = await inFrame(DATABASE, () =>
        browser.execute(
          () => (window as unknown as { e2ePaste?: { text: string; html: string } }).e2ePaste,
        ),
      );
      return got !== undefined;
    },
    { timeout: 10_000, timeoutMsg: "Mod+V pasted nothing in the plugin's page" },
  );
  return got as { text: string; html: string };
}

const pbpaste = () => (mac ? execFileSync("pbpaste", { encoding: "utf8" }) : undefined);
const forget = (text: string) => {
  if (mac) execFileSync("pbcopy", { input: text });
};

(has("sqlite3") ? describe : describe.skip)(
  "database: a copy from the palette reaches the clipboard",
  () => {
    let kept: string | undefined;

    before(async () => {
      kept = pbpaste();
      await shellReady();
      await clearDesk([DATABASE]);
      await feed([{ type: "windowFocused", focused: true }]);
      const file = join(process.env[HOME_VAR] ?? "", "shop.db");
      // `wide` has 240 columns: its first page of 500 rows is 120,000 cells.
      const columns = Array.from({ length: 240 }, (_, i) => `c${i + 1}`);
      execFileSync("sqlite3", [
        file,
        [
          "create table people(id integer primary key, name text, note text);",
          "insert into people values (1, 'Ada', 'one'), (2, 'Bob', null);",
          `create table wide(${columns.join(", ")});`,
          "with recursive n(i) as (select 1 union all select i + 1 from n where i < 500)",
          `insert into wide select ${columns.map(() => "i").join(", ")} from n;`,
        ].join("\n"),
      ]);
      await run("desk.plugins.open", { plugin: DATABASE });
      await windowUntil(DATABASE, (w) => !w.hidden, "the database window shows");
      // The window in use fills the app, so its grid is in sight whatever the first layout gave it.
      await inUse(DATABASE);
      await run("desk.display.maximize");
      await windowUntil(DATABASE, (w) => w.state === "filled", "the database window fills the app");
      await run("endue.database.new-connection", { engine: "sqlite", file, name: "shop" });
      await inFrame(DATABASE, () => press("#form button[type=submit]"));
      await browser.waitUntil(
        async () =>
          (await inFrame(DATABASE, () =>
            browser.execute(() =>
              [...document.querySelectorAll("#tree [role=treeitem]")].some((item) =>
                item.textContent?.includes("shop"),
              ),
            ),
          )) === true,
        { timeout: 20_000, timeoutMsg: "the connection was never saved" },
      );
      await run("endue.database.open-table", { connection: "shop", schema: "", table: "people" });
      await browser.waitUntil(async () => (await cells()) === 6, {
        timeout: 20_000,
        timeoutMsg: "the people table never showed",
      });
    });

    after(() => {
      if (kept !== undefined) forget(kept);
    });

    it("refuses a clipboard call the person did not start, at once", async () => {
      const answers = await inFrame(DATABASE, () =>
        browser.execute(async () => {
          const settle = (p: Promise<unknown>) =>
            Promise.race([
              p.then(
                () => "written",
                (e: unknown) => String((e as Error).name),
              ),
              new Promise((done) => setTimeout(() => done("left hanging"), 4_000)),
            ]);
          return {
            active: navigator.userActivation.isActive,
            write: await settle(navigator.clipboard.writeText("not asked for")),
            read: await settle(navigator.clipboard.readText()),
          };
        }),
      );
      expect(answers).toEqual({ active: false, write: "NotAllowedError", read: "NotAllowedError" });
    });

    it("Copy as TSV from the palette puts the rows and an HTML table on the clipboard", async () => {
      forget("before");
      await fromPalette("copy the result as", ["Database: copy the result as", "tsv"]);
      await says("Copied as TSV.");
      if (mac) expect(pbpaste()).toBe(PEOPLE_TSV);
      const back = await pasted();
      expect(back.text).toBe(PEOPLE_TSV);
      expect(back.html).toMatch(/<table>/u);
      expect(back.html).toContain(PEOPLE_ROWS);
    });

    it("Copy as CSV from the palette while another window is in use", async () => {
      forget("before");
      await run("desk.plugins.open", { plugin: HELLO });
      await windowUntil(HELLO, (w) => !w.hidden, "the hello window shows");
      await inUse(HELLO);
      await fromPalette("copy the result as", ["Database: copy the result as", "csv"]);
      await says("Copied as CSV.");
      const csv = "id,name,note\r\n1,Ada,one\r\n2,Bob,";
      if (mac) expect(pbpaste()).toBe(csv);
      expect((await pasted()).text).toBe(csv);
    });

    it("the value viewer's Copy, pressed in the page, copies the whole value", async () => {
      forget("before");
      await feed(keyPress("v", "KeyV", "v"));
      await click(await spot("#value-copy"));
      await says("Copied the value.");
      await feed(keyPress("Escape", "Escape"));
      if (mac) expect(pbpaste()).toBe("1");
      expect((await pasted()).text).toBe("1");
    });

    it("a copy past 100,000 cells asks first: No copies nothing, Yes copies it all", async () => {
      await run("endue.database.open-table", { connection: "shop", schema: "", table: "wide" });
      await browser.waitUntil(
        async () => (await inFrame(DATABASE, () => $("#page").getText())).startsWith("1–500"),
        { timeout: 20_000, timeoutMsg: "the wide table never showed" },
      );
      forget("before");
      const question = "Copy 120,000 cells to the clipboard?";
      await fromPalette("copy the result as", ["Database: copy the result as", "tsv"]);
      await paletteAsks(question);
      expect((await palette()).rows).toEqual(["Yes", "No"]);
      await inFrame(PALETTE, () =>
        browser.saveScreenshot("e2e/test-results/database-copy-question.png"),
      );
      await type("no");
      await browser.pause(300);
      await enter();
      await says("Nothing copied.");
      if (mac) expect(pbpaste()).toBe("before");

      await fromPalette(
        "copy the result as",
        ["Database: copy the result as", "tsv"],
        [question, "yes"],
      );
      await says("Copied as TSV.");
      const back = await pasted();
      const lines = back.text.split("\n");
      expect(lines).toHaveLength(500);
      expect(lines[499]).toBe(Array(240).fill("500").join("\t"));
      expect(back.html.match(/<tr>/gu)).toHaveLength(500);
    });
  },
);
