// Synthetic files for worker/progress QA; no user files or credentials. Usage: node <this> /tmp/data-qa
import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

const folder = process.argv[2];
if (!folder) throw new Error("Pass a scratch output folder.");
mkdirSync(folder, { recursive: true });
function write(name, minimum, head, row, tail) {
  const fd = openSync(join(folder, name), "w");
  let size = writeSync(fd, head);
  let count = 0;
  try {
    while (size < minimum) size += writeSync(fd, row(count++));
    size += writeSync(fd, tail);
  } finally {
    closeSync(fd);
  }
  console.log(`${name}: ${size} bytes, ${count} records`);
}
write(
  "large-50mb.json",
  50 * 1024 * 1024,
  "[\n",
  (id) =>
    `${id ? ",\n" : ""}${JSON.stringify({ id, name: `Dataset item ${id}`, category: "inspection", enabled: true, token: `fixture-token-${id}`, description: "Generated local QA sample. ".repeat(5) })}`,
  "\n]\n",
);
write(
  "large-20mb.yaml",
  20 * 1024 * 1024,
  "records:\n",
  (id) =>
    `  - id: ${id}\n    name: Dataset item ${id}\n    category: inspection\n    password: fixture-password-${id}\n    description: ${"Generated local QA sample. ".repeat(5)}\n`,
  "",
);
