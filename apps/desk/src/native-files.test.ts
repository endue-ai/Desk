// Files from the OS on the CEF shell (#45): the picker through the shell's dialog command. Drags from
// the OS go through the compositor's input (crates/desk-compositor/tests/input_dnd.rs).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickNativeFile, realNativePath } from "./native-files";

const shell = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("./host", () => ({ invoke: shell.invoke }));

beforeEach(() => {
  vi.clearAllMocks();
  shell.invoke.mockResolvedValue(null);
});

describe("native file entry", () => {
  it("picks one local file through the shell's dialog command and preserves cancellation", async () => {
    expect(await pickNativeFile()).toBeNull();
    expect(shell.invoke).toHaveBeenCalledWith("plugin:dialog|open", {
      options: { multiple: false, directory: false },
    });
    shell.invoke.mockResolvedValue("C:\\Users\\Person\\notes.md");
    expect(await pickNativeFile()).toBe("C:/Users/Person/notes.md");
    shell.invoke.mockResolvedValue("/notes/a\\b.md");
    expect(await pickNativeFile()).toBe("/notes/a\\b.md");
    shell.invoke.mockResolvedValue("\\\\server\\share\\notes.md");
    expect(await pickNativeFile()).toBe("//server/share/notes.md");
    shell.invoke.mockResolvedValue("relative.md");
    expect(await pickNativeFile()).toBeNull();
  });

  it("names a file as the shell does, and keeps the path when the shell cannot say", async () => {
    shell.invoke.mockResolvedValue("~/files/small.csv");
    expect(await realNativePath("/private/tmp/files/small.csv")).toBe("~/files/small.csv");
    expect(shell.invoke).toHaveBeenCalledWith("real_path", {
      path: "/private/tmp/files/small.csv",
    });
    shell.invoke.mockRejectedValue(new Error("this page may not use the command real_path"));
    expect(await realNativePath("~/a.md")).toBe("~/a.md");
    shell.invoke.mockResolvedValue(null);
    expect(await realNativePath("~/a.md")).toBe("~/a.md");
  });
});
