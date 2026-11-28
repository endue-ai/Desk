// Release signing secrets reach only the steps that sign, and the jobs that hold them run actions
// pinned by commit, so a moved tag cannot run new code beside them (#816).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const read = (name) =>
  readFileSync(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const RELEASE = [
  "release-build",
  "release-macos",
  "canary",
  "release",
  "release-final",
  "release-cut",
  "rollout",
  "rollback",
];

test("the Apple secrets reach the packaging step only, never the job's environment", () => {
  const build = parse(read("release-build")).jobs.build;
  const steps = build.steps.filter((step) =>
    /secrets\.APPLE_/u.test(JSON.stringify(step.env ?? {})),
  );
  assert.deepEqual(
    steps.map((step) => step.name),
    [
      "Package, sign and notarise endue with cargo-packager",
      "Test installation of each endue app package",
    ],
  );
  const smoke = steps[1].env;
  assert.deepEqual(
    Object.keys(smoke).filter((key) => /APPLE/u.test(key)),
    ["APPLE_SIGNED"],
  );
  assert.match(smoke.APPLE_SIGNED, /secrets\.APPLE_CERTIFICATE != ''/u, "a boolean, not a value");
  assert.doesNotMatch(JSON.stringify(build.env ?? {}), /secrets\./u);
  for (const step of build.steps) {
    assert.doesNotMatch(
      step.run ?? "",
      /APPLE_[A-Z_]*=.*GITHUB_ENV|AuthKey.*GITHUB_ENV/u,
      step.name,
    );
  }
  const pack = steps[0].run;
  assert.match(
    pack,
    /trap 'rm -f "\$APPLE_API_KEY_PATH"' EXIT/u,
    "the key file ends with the step",
  );
  assert.doesNotMatch(pack, /cargo install/u, "the packager is installed without the secrets");
});

test("release workflows run remote actions pinned to a commit", () => {
  for (const name of RELEASE) {
    for (const [, ref] of read(name).matchAll(/^\s*(?:- )?uses: (\S+)/gmu)) {
      if (ref.startsWith("./")) continue;
      assert.match(ref, /@[0-9a-f]{40}$/u, `${name}: ${ref}`);
    }
  }
});
