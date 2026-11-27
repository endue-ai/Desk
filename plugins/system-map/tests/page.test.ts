// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { mountPage } from "../ui/page.js";
import { snapshot } from "../ui/topology.js";

it("collects on request, opens a branch and shows the selected element after refresh", async () => {
  document.body.innerHTML = readFileSync(new URL("../ui/index.html", import.meta.url), "utf8")
    .split("<body>")[1]
    .split("</body>")[0];
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
