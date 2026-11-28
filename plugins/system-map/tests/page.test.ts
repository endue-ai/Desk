// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { mountPage } from "../ui/page.js";
import { snapshot } from "../ui/topology.js";

beforeEach(() => {
  const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

it("collects on request, opens a branch and shows the selected element after refresh", async () => {
  const collect = vi.fn(async () =>
    snapshot({ interfaces: "en0: flags=1<UP> mtu 1500\n\tinet 192.0.2.5" }),
  );
  const t = (key: string) => key;
  mountPage(document, { collect, t, supported: true });
  expect(collect).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("#refresh")?.click();
  await vi.waitFor(() => expect(document.querySelector('[data-id="network"]')).toBeTruthy());
  const click = (id: string) =>
    document.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)?.click();
  click("network");
  click("interfaces");
  const adapter = Array.from(document.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("en0"),
  );
  expect(adapter).toBeDefined();
  adapter?.click();
  expect(document.querySelector("#details")?.textContent).toContain("192.0.2.5");
  document.querySelector<HTMLButtonElement>("#refresh")?.click();
  await vi.waitFor(() => expect(collect).toHaveBeenCalledTimes(2));
  expect(document.querySelector("#details")?.textContent).toContain("192.0.2.5");
});

it("offers a person-triggered permission retry and keeps the last snapshot after a failed refresh", async () => {
  const collect = vi
    .fn()
    .mockRejectedValueOnce(new Error("denied"))
    .mockResolvedValueOnce(
      snapshot({
        hardware: JSON.stringify({ SPHardwareDataType: [{ machine_name: "Test host" }] }),
      }),
    )
    .mockRejectedValueOnce(new Error("failed"));
  mountPage(document, { collect, supported: true, t: (key: string) => key });
  const button = document.querySelector<HTMLButtonElement>("#refresh");
  button?.click();
  await vi.waitFor(() => expect(button?.textContent).toBe("allow"));
  button?.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#detail-title")?.textContent).toBe("Test host"),
  );
  expect(collect.mock.calls[1]?.[1]).toBe(true);
  button?.click();
  await vi.waitFor(() =>
    expect(document.querySelector("#status")?.textContent).toContain("status.failed"),
  );
  expect(document.querySelector("#detail-title")?.textContent).toBe("Test host");
});

it("identifies unsupported platforms before requesting access", () => {
  const collect = vi.fn();
  mountPage(document, { collect, supported: false, t: (key: string) => key });
  expect(document.querySelector<HTMLButtonElement>("#refresh")?.disabled).toBe(true);
  expect(document.querySelector("#status")?.textContent).toBe("status.unsupported");
  expect(collect).not.toHaveBeenCalled();
});
