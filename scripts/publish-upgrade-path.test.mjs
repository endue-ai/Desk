import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

// `pnpm --filter @endue-ai/desk-app exec` runs its command in apps/desk, so a stub that signs from
// there finds only the paths that hold from there.
const pnpm = `#!/bin/bash
cd "${join(root, "apps/desk")}" || exit 1
file="\${@: -1}"
[ -f "$file" ] || { echo "stub pnpm: no $file in $PWD" >&2; exit 1; }
echo test-signature > "$file.sig"
`;

test("sign writes and signs the upgrade path into a folder named relative to the checkout", (t) => {
  const work = mkdtempSync(join(tmpdir(), "endue-upgrade-path-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  const [bin, dist] = [join(work, "bin"), join(work, "dist")];
  mkdirSync(bin);
  mkdirSync(dist);
  writeFileSync(join(bin, "pnpm"), pnpm);
  chmodSync(join(bin, "pnpm"), 0o755);
  const name = "endue_0.5.0_linux-x86_64.deb";
  writeFileSync(join(dist, name), "package");
  writeFileSync(join(dist, `${name}.sig`), "test-signature");
  // As release-build.yml passes it: a path relative to the checkout, not to apps/desk.
  const out = relative(root, join(work, "upgrade-path"));
  const args = ["scripts/publish-upgrade-path.sh", "sign", dist, "0.5.0", "c46d12b", "", out];
  const run = spawnSync("bash", args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(run.status, 0, run.stderr);
  for (const file of [
    "release.json",
    "release.json.sig",
    "UPGRADE_PATH.json",
    "UPGRADE_PATH.json.sig",
  ]) {
    assert.ok(existsSync(join(work, "upgrade-path", file)), `${file} was not written`);
  }
});
