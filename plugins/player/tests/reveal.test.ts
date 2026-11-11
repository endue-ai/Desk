import { describe, expect, it, vi } from "vitest";
import { reveal, revealLabel } from "../ui/reveal.js";

describe("Show in Finder", () => {
  it("names the system's file manager", () => {
    expect(revealLabel("MacIntel")).toBe("Show in Finder");
    expect(revealLabel("Win32")).toBe("Show in File Explorer");
    expect(revealLabel("Linux x86_64")).toBe("Show in the file manager");
  });

  it("asks shell.open to reveal exactly the one file", async () => {
    const call = vi.fn().mockResolvedValue({ opened: true });
    await reveal({ call }, "~/Movies/clip.mp4");
    expect(call).toHaveBeenCalledExactlyOnceWith("shell.open", {
      target: "~/Movies/clip.mp4",
      reveal: true,
      scope: { permission: "shell:open", paths: ["~/Movies/clip.mp4"] },
    });
  });

  it("says why it could not, and never asks for a pattern wider than the file", async () => {
    const refusing = (code: string) => ({ call: vi.fn().mockRejectedValue({ code }) });
    await expect(reveal(refusing("permission_denied"), "~/a.mp4")).rejects.toThrow(
      /^Not allowed to show a\.mp4 in /,
    );
    await expect(reveal(refusing("not_found"), "~/a.mp4")).rejects.toThrow(
      "a.mp4 is no longer where it was.",
    );
    const call = vi.fn();
    await expect(reveal({ call }, "~/Movies/take*.mp4")).rejects.toThrow(/holds \* or \?/);
    expect(call).not.toHaveBeenCalled();
  });
});
