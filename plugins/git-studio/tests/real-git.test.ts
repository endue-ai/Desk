import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { realGit } from "./real-git";

const input = "test input\n".repeat(400_000);

it("closes an empty stdin and passes every byte to a Git command that reads input", async () => {
  const empty = await realGit.run(["hash-object", "--stdin"]);
  const full = await realGit.run(["hash-object", "--stdin"], { input });
  const objectId = (value: string) =>
    createHash("sha1")
      .update(`blob ${Buffer.byteLength(value)}\0`)
      .update(value)
      .digest("hex");
  expect(empty.stdout.trim()).toBe(objectId(""));
  expect(full.stdout.trim()).toBe(objectId(input));
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
