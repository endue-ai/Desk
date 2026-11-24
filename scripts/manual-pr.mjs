import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || String(number) !== String(value)) {
    throw new Error("Enter a positive PR number.");
  }
  return number;
}

export function selectPull(pull, number, repository) {
  if (
    pull.number !== number ||
    pull.state !== "open" ||
    pull.base?.repo?.full_name !== repository
  ) {
    throw new Error("Select an open PR in this repository.");
  }
  const { base, head } = pull;
  const sha = /^[a-f0-9]{40}$/u;
  if (!sha.test(base.sha) || !sha.test(head.sha)) throw new Error("Invalid PR commit.");
  const lines = pull.additions + pull.deletions;
  if (!Number.isSafeInteger(lines) || lines < 0) throw new Error("Invalid PR size.");
  const labels = pull.labels.map((label) => label.name);
  return {
    number,
    base: base.sha,
    head: head.sha,
    release: base.ref.startsWith("release/"),
    refactor: labels.includes("kind:refactor"),
    lines,
    review: head.repo?.full_name === repository && !pull.draft && !labels.includes("dependencies"),
  };
}

function main() {
  const number = parseNumber(process.env.PR);
  const repository = process.env.GITHUB_REPOSITORY;
  const pull = JSON.parse(
    execFileSync("gh", ["api", "repos/" + repository + "/pulls/" + number], {
      encoding: "utf8",
    }),
  );
  for (const [key, value] of Object.entries(selectPull(pull, number, repository))) {
    appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + value + "\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
