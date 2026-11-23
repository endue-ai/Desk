import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const directory = new URL("../.github/workflows/", import.meta.url);
const workflow = (file) => parse(readFileSync(new URL(file, directory), "utf8"));

test("public workflow labels, input descriptions and notices use the endue name", () => {
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".yml"))) {
    const config = workflow(file);
    const messages = [config.name];
    for (const event of Object.values(config.on)) {
      for (const input of Object.values(event?.inputs ?? {})) messages.push(input.description);
    }
    for (const job of Object.values(config.jobs)) {
      messages.push(job.name);
      for (const step of job.steps ?? []) {
        messages.push(step.name);
        for (const line of (step.run ?? "").split("\n")) {
          if (/::(?:error|warning|notice)::/u.test(line)) messages.push(line);
        }
      }
    }
    assert.doesNotMatch(messages.join("\n"), /(?<![\w./-])desks?(?![\w/-])/iu, file);
  }
  const steps = workflow("release-build.yml").jobs.build.steps;
  const build = steps.find((step) => step.run?.includes("cargo build"));
  assert.match(build.name, /\bendue\b/u);
});

test("plugin validation runs the official endue command on the manifests", () => {
  const job = workflow("plugin-validate.yml").jobs["plugin-validate"];
  const step = job.steps.find((step) => step.run?.includes("plugin validate"));
  assert.match(step.name, /\bendue\b/u);
  assert.match(step.run, /\.\/target\/debug\/endue plugin validate "\$dir"/u);
});
