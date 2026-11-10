/**
 * The stub's desk folder answers the runtime's fs.write as desk-core does (#102): the scope covers
 * the path, the runtime's grant on the folder (`~/.desk/profiles/**` and `~/.desk/keys.yaml`, as
 * desk-boot grants it) covers the scope, a folder `createDirs` would make is inside the scope
 * (core_fs.rs), and without it the folder must be there. Before, the stub wrote whatever it was
 * given, so the runtime's own save passed here and failed on the real core.
 */
import type { BridgeEvent, FsWriteParams } from "@endue-ai/bridge";
import { describe, expect, it } from "vitest";
import { stubFolder } from "./folder";

const PROFILE = "~/.desk/profiles/mine.yaml";

function folder(files: Record<string, string> = {}) {
  const events: BridgeEvent[] = [];
  const { folder, handlers } = stubFolder(files, (event) => events.push(event));
  const write = (params: Omit<FsWriteParams, "content">) =>
    Promise.resolve()
      .then(() => handlers["fs.write"]?.({ content: "name: Mine\n", ...params }, undefined))
      .then(
        (result) => ({ ok: true as const, result }),
        (error: { code?: string; message?: string }) => ({
          ok: false as const,
          code: error.code,
          message: error.message,
        }),
      );
  return { folder, write };
}

const scope = (...paths: string[]) => ({ permission: "fs:write" as const, paths });

describe("the stub's desk folder writes as desk-core does (#102)", () => {
  it("creates a folder only inside the scope", async () => {
    const f = folder();
    expect(await f.write({ path: PROFILE, createDirs: true, scope: scope(PROFILE) })).toEqual({
      ok: false,
      code: "permission_denied",
      message: "the scope does not cover ~/.desk/profiles",
    });
    expect(f.folder.read(PROFILE)).toBeUndefined();
    const named = scope(PROFILE, "~/.desk/profiles");
    expect(await f.write({ path: PROFILE, createDirs: true, scope: named })).toMatchObject({
      ok: true,
      result: { bytesWritten: 11 },
    });
    expect(f.folder.read(PROFILE)).toBe("name: Mine\n");
  });

  it("without createDirs, the folder must be there", async () => {
    const f = folder();
    expect(await f.write({ path: PROFILE, scope: scope(PROFILE) })).toMatchObject({
      ok: false,
      code: "not_found",
    });
    const g = folder({ "~/.desk/profiles/other.yaml": "name: Other\n" });
    expect(await g.write({ path: PROFILE, scope: scope(PROFILE) })).toMatchObject({ ok: true });
    // The desk folder itself is always there (the core makes it for plugins.lock).
    expect(
      await g.write({ path: "~/.desk/keys.yaml", scope: scope("~/.desk/keys.yaml") }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a scope the path is not in, and one the runtime's grant does not cover", async () => {
    const f = folder();
    expect(await f.write({ path: PROFILE, scope: scope("~/.desk/keys.yaml") })).toMatchObject({
      ok: false,
      code: "permission_denied",
      message: `the scope does not cover ${PROFILE}`,
    });
    const init = "~/.desk/init.yaml";
    expect(await f.write({ path: init, scope: scope(init) })).toMatchObject({
      ok: false,
      code: "permission_denied",
      message: "no grant covers the scope",
    });
    expect(
      await f.write({
        path: "~/.desk/keys.yaml",
        createDirs: true,
        scope: scope("~/.desk/keys.yaml"),
      }),
    ).toMatchObject({ ok: false, message: "the scope does not cover ~/.desk" });
  });
});
