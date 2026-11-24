import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const directory = new URL("../.github/workflows/", import.meta.url);
const workflows = new Map(
  readdirSync(directory)
    .filter((name) => /\.ya?ml$/iu.test(name))
    .map((name) => [name, parse(readFileSync(new URL(name, directory), "utf8"))]),
);

test("every workflow starts manually or is called inside a manual run", () => {
  const direct = [];
  for (const [filename, workflow] of workflows) {
    assert.ok(
      workflow.on && typeof workflow.on === "object" && !Array.isArray(workflow.on),
      filename,
    );
    for (const event of Object.keys(workflow.on)) {
      assert.ok(
        ["workflow_dispatch", "workflow_call"].includes(event),
        filename + " subscribes to " + event,
      );
    }
    if (Object.hasOwn(workflow.on, "workflow_dispatch")) direct.push(filename);
  }
  assert.ok(direct.length > 0);
  const reachable = new Set();
  function visit(filename) {
    if (reachable.has(filename)) return;
    reachable.add(filename);
    for (const job of Object.values(workflows.get(filename).jobs)) {
      if (!job.uses?.startsWith("./.github/workflows/")) continue;
      const target = job.uses.slice("./.github/workflows/".length);
      assert.ok(
        workflows.has(target) && Object.hasOwn(workflows.get(target).on, "workflow_call"),
        job.uses,
      );
      visit(target);
    }
  }
  for (const filename of direct) visit(filename);
  assert.deepEqual([...reachable].sort(), [...workflows.keys()].sort());
});

test("the manual CI run tests the selected merge commit on every platform and in its release rehearsal", () => {
  const { jobs } = workflows.get("ci.yml");
  for (const name of [
    "linux-verification",
    "runtime-e2e-shard",
    "check-macos",
    "check-windows",
    "shell-build",
    "codegen-check",
  ]) {
    const checkout = jobs[name].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with.ref, "${{ needs.changes.outputs.commit }}", name);
  }
  assert.equal(jobs["release-dry-run"].with.ref, "${{ needs.changes.outputs.commit }}");
  assert.equal(jobs["red-on-base"].steps[0].with.ref, "${{ needs.changes.outputs.base }}");
  const dry = workflows.get("release-dry-run.yml");
  assert.equal(dry.jobs.build.with.ref, "${{ inputs.ref || github.sha }}");
  assert.equal(dry.jobs.build.with["dry-run"], true);
});

test("a manual PR run refuses a cached merge when its target branch has advanced", () => {
  const pin = workflows.get("ci.yml").jobs.changes.steps.find((step) => step.id === "target");
  assert.ok(pin.run.includes('"refs/heads/$base_ref:refs/endue/ci-base"'));
  assert.ok(pin.run.includes('"refs/pull/$PR/merge:refs/endue/ci-merge"'));
  assert.ok(pin.run.includes('"$(git rev-parse refs/endue/ci-base)" != "$BASE"'));
});
