import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { gitOutput, realGit, tempRepo } from "./real-git";

const input = "test input\n".repeat(400_000);

it("closes an empty stdin and passes every byte to a Git command that reads input", async () => {
  const repo = await tempRepo();
  try {
    const file = join(repo.root, "input");
    for (const value of ["", input]) {
      writeFileSync(file, value);
      const stored = await repo.git("hash-object", file);
      const piped = await realGit.run(["hash-object", "--stdin"], {
        cwd: repo.root,
        input: value || undefined,
      });
      expect(piped.stdout).toBe(stored.stdout);
    }
    const bytes = Buffer.from([0, 255, 97, 128, 10]);
    writeFileSync(file, bytes);
    const object = await repo.git("hash-object", "-w", file);
    const raw = await gitOutput(["cat-file", "blob", object.stdout.trim()], {
      cwd: repo.root,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    expect(raw.code).toBe(0);
    expect(raw.stdout).toEqual(bytes);
  } finally {
    repo.done();
  }
});

it("uses the child's result when it closes stdin before a large write finishes", async () => {
  const version = await realGit.run(["--version"], { input });
  expect(version.code).toBe(0);
  expect(version.stdout).toMatch(/^git version /u);
  const args = ["endue-fixture-unknown-command"];
  const failed = await realGit.run(args, { input, ok: [1] });
  expect(failed.code).toBe(1);
  expect(failed.stderr).toContain(args[0]);
  await expect(realGit.run(args, { input })).rejects.toMatchObject({ outcome: failed });
});
