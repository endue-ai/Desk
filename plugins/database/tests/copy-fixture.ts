// A COPY through standard input or output on the fixture's PostgreSQL server (PG-23), for the
// runtime page: `COPY items TO STDOUT` answers the fixture's three items as the server's text
// format, `COPY items FROM STDIN` waits for its data (the stub's sessions count its lines), and every
// other statement goes to `script`. A file to copy in waits in ~/Downloads. Fixture data only.
import type { Script } from "./clients";

/** The items as `COPY items TO STDOUT` writes them. */
export const COPY_ITEMS = [
  '1\tok\t{"size": 1}\tt\t{a,b}\t2026-11-21 09:00:00+00',
  '2\tsad\t{"size": 2}\tf\t{}\t2026-11-20 18:30:00+00',
  '3\tso so\t[1, 2, 3]\tt\t{"c d"}\t2026-11-19 07:15:00+00',
]
  .map((line) => `${line}\n`)
  .join("");
/** The file the open dialog answers for a COPY in, and what it holds. */
export const COPY_IN_FILE = "~/Downloads/items-more.txt";
export const COPY_IN_TEXT = `${COPY_ITEMS.replaceAll(/^(\d)/gmu, "1$1")}14\tok\t{}\tf\t{}\t2026-11-18 12:00:00+00\n`;

export function copyScript(script: Script): Script {
  return (sql, who) => {
    if (/^\s*copy\s+items\s+to\s+stdout\b/iu.test(sql))
      return { copy: { direction: "out", data: COPY_ITEMS } };
    if (/^\s*copy\s+items\s+from\s+stdin\b/iu.test(sql))
      return { copy: { direction: "in", columns: 6 } };
    return script(sql, who);
  };
}
