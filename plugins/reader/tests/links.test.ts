import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

it("external document links ask once and open only the three granted schemes", async () => {
  expect(
    existsSync(join(import.meta.dirname, "../ui/links.js")),
    "external link handler is implemented",
  ).toBe(true);
  const { createLinks } = await import("../ui/links.js");
  let granted = false;
  const call = vi.fn(async (method, _params) => {
    if (method === "perm.request") {
      granted = true;
      return { granted: true };
    }
    if (!granted) throw { code: "permission_denied" };
    return {};
  });
  const open = createLinks({ call });
  await open("https://example.com/");
  await open("mailto:reader@example.com");
  const scope = { permission: "shell:open", schemes: ["http", "https", "mailto"] };
  expect(call).toHaveBeenCalledWith("shell.open", { url: "https://example.com/", scope });
  expect(call.mock.calls.filter(([name]) => name === "perm.request")).toHaveLength(1);
  call.mockClear();
  await open("javascript:alert(1)");
  await open("file:///tmp/private");
  await open("#chapter2");
  expect(call).not.toHaveBeenCalled();
});
