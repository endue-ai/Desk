// The executable: `pnpm create @endue-ai/plugin <folder>` runs the build of this file.

import { main } from "./cli";

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
