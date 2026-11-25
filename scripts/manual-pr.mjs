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

export function selectPull(pull, number, repository, currentBase) {
  if (
    pull.number !== number ||
    pull.state !== "open" ||
    pull.base?.repo?.full_name !== repository
  ) {
    throw new Error("Select an open PR in this repository.");
  }
  const { base, head } = pull;
  const sha = /^[a-f0-9]{40}$/u;
  if (
    !sha.test(base.sha) ||
    !sha.test(head.sha) ||
    currentBase?.ref !== "refs/heads/" + base.ref ||
    currentBase.object?.type !== "commit" ||
    !sha.test(currentBase.object.sha)
  ) {
    throw new Error("Invalid PR commit.");
  }
  const lines = pull.additions + pull.deletions;
  if (!Number.isSafeInteger(lines) || lines < 0) throw new Error("Invalid PR size.");
  const labels = pull.labels.map((label) => label.name);
  return {
    number,
    base: currentBase.object.sha,
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
  const api = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", "repos/" + repository + "/" + path], { encoding: "utf8" }),
    );
  const pull = api("pulls/" + number);
  // The PR summary can retain its previous base after GitHub has rebuilt the merge commit.
  const branch = pull.base.ref.split("/").map(encodeURIComponent).join("/");
  const currentBase = api("git/ref/heads/" + branch);
  for (const [key, value] of Object.entries(selectPull(pull, number, repository, currentBase))) {
    appendFileSync(process.env.GITHUB_OUTPUT, key + "=" + value + "\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
