// Configure the ephemeral Ubuntu CI runner before explicit apt installs or Playwright --with-deps.
// The runner's mirror transport can return to Azure for each index even after an InRelease fallback.
// https://github.com/actions/runner-images/blob/main/images/ubuntu/scripts/build/configure-apt-sources.sh
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const canonical = "https://archive.ubuntu.com/ubuntu/";
const runnerMirror =
  /(^|\s)(?:mirror\+file:\/etc\/apt\/apt-mirrors\.txt|https?:\/\/azure\.archive\.ubuntu\.com\/ubuntu\/?)(?=\s|$)/gm;

// The image itself has a zz-retries fragment. APT reads these files in ascending filename order.
// https://manpages.debian.org/bookworm/apt/apt.conf.5.en.html
const config = `Acquire::Retries "1";
Acquire::http::Timeout "30";
Acquire::https::Timeout "30";
APT::Update::Error-Mode "any";
`;

/** Change only the known Ubuntu mirror URIs; preserve suites, components and signing keys. */
export async function configureApt(root = "/etc/apt") {
  const parts = join(root, "sources.list.d");
  const entries = await readdir(parts, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [
    join(root, "sources.list"),
    ...entries
      .filter((entry) => /\.(?:list|sources)$/.test(entry.name))
      .map((entry) => join(parts, entry.name)),
  ];
  const changed = [];
  for (const file of files) {
    const before = await readFile(file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (before === null) continue;
    const after = before.replace(runnerMirror, (_match, space) => `${space}${canonical}`);
    if (after === before) continue;
    await writeFile(file, after);
    changed.push(file);
  }
  await mkdir(join(root, "apt.conf.d"), { recursive: true });
  await writeFile(join(root, "apt.conf.d/zzzz-desk-ci"), config, { mode: 0o644 });
  return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== "linux" || process.getuid?.() !== 0) {
    throw new Error("CI APT setup must run as root on the Ubuntu runner.");
  }
  const changed = await configureApt();
  console.log(`CI APT: canonical Ubuntu archive configured in ${changed.length} source file(s).`);
  const result = spawnSync(
    "apt-config",
    [
      "shell",
      "Retries",
      "Acquire::Retries",
      "HttpTimeout",
      "Acquire::http::Timeout",
      "HttpsTimeout",
      "Acquire::https::Timeout",
      "UpdateErrorMode",
      "APT::Update::Error-Mode",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`apt-config failed (${result.status}).`);
}
