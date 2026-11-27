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

test("plugin validation builds native examples before checking the program paths", () => {
  const config = workflow("plugin-validate.yml");
  assert.deepEqual(Object.keys(config.on), ["workflow_dispatch"]);
  const job = config.jobs["plugin-validate"];
  assert.equal(job["timeout-minutes"], 10);
  assert.equal(job.env.CARGO_PROFILE_DEV_DEBUG, "0");
  assert.equal(job.env.CARGO_INCREMENTAL, "0");
  const commands = job.steps.map((step) => step.run ?? "");
  assert.ok(commands.includes("cargo build --locked -p desk-cli --bin endue"));
  const build = commands.findIndex((cmd) => cmd.includes("node scripts/example.mjs build"));
  const check = commands.findIndex((cmd) => cmd.includes("endue plugin validate"));
  assert.ok(build >= 0 && build < check);
  assert.match(commands[build], /examples\/\*\/plugin\.json/u);
});
