// The executable: `pnpm create @endue-ai/plugin <folder>` runs the build of this file.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./cli";

// Built to packages/create-plugin/dist/, so the Desk repository is three folders up, when it is
// there; DESK_REPO names another, as it does for `desk plugin test`.
const repo = process.env.DESK_REPO ?? fileURLToPath(new URL("../../../", import.meta.url));
const desk = existsSync(join(repo, "packages/ui/src/theme/index.ts")) ? repo : undefined;

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
  ...(desk === undefined ? {} : { desk }),
});
