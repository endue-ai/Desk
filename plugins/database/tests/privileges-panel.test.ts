// @vitest-environment jsdom
// The privileges panel's DOM (ui/features/privileges/panel.js) and its change dialog (dialog.js),
// drawn from the states the feature reads over privileges-fixture.ts: the tabs, a matrix cell that
// names its grantors and cycles none → granted → with grant option, the review count, and a role's
// password field that never shows what is typed, whose script shows the mask.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { feature } from "../ui/features/privileges/index.js";
import type { ChangeModel } from "../ui/features/privileges/models.js";
import { MASK } from "../ui/features/privileges/roles.js";
import { fixtureScript } from "./fixtures";
import { mount, SAVED } from "./harness";
import { privilegesServer } from "./privileges-fixture";

const panel = feature.panels?.privileges;
const dialog = feature.dialogs?.["privileges-change"];
if (!panel || !dialog) throw new Error("the privileges feature draws a panel and a dialog");
const DEV: Connection = { ...(SAVED[1] as Connection), id: "c-dev", name: "Dev", tag: "none" };

/** The feature's state after `go`, read from the scripted server. */
async function stateAfter(go: (m: Awaited<ReturnType<typeof mount>>) => Promise<unknown>) {
  let model: ChangeModel | undefined;
  const m = await mount({
    store: { connections: [DEV] },
    script: privilegesServer(fixtureScript).script,
    dialog: (_type, given) => {
      model = given as ChangeModel;
      return undefined;
    },
  });
  await go(m);
  const shown = m.shown() as unknown as { id: string; privileges: Record<string, unknown> };
  return { state: shown.privileges, id: shown.id, model: () => model };
}

const drawn: HTMLElement[] = [];
function draw(state: Record<string, unknown>) {
  const act = vi.fn();
  const made = panel?.render(document, state as never, act, {
    id: "b-1",
    connection: DEV.id,
    name: "privileges",
  });
  if (!made || "nodeType" in made) throw new Error("the panel changes in place");
  document.body.append(made.el);
  drawn.push(made.el);
  return { act, el: made.el, update: made.update };
}
afterEach(() => {
  for (const el of drawn.splice(0)) el.remove();
});

describe("the privileges panel", () => {
  it("draws the roles in their tab and switches tabs through its action", async () => {
    const { state } = await stateAfter((m) =>
      m.host.command("endue.database.privileges", { connection: "Dev" }),
    );
    const { el, act } = draw(state);
    const tabs = [...el.querySelectorAll<HTMLButtonElement>("[data-tab]")];
    expect(tabs.map((t) => [t.dataset.tab, t.getAttribute("aria-selected")])).toEqual([
      ["roles", "true"],
      ["object", "false"],
      ["role", "false"],
      ["defaults", "false"],
    ]);
    const roles = [...el.querySelectorAll(".privileges-roles tbody tr")].map(
      (r) => r.querySelector("th, td")?.textContent,
    );
    expect(roles).toEqual(["ana", "app", "reports"]);
    tabs[2]?.click();
    expect(act).toHaveBeenCalledWith("privilegesTab", "b-1", "role");
  });

  it("names each cell's grantors, presses it and counts the changes to review", async () => {
    const { state } = await stateAfter((m) =>
      m.host.command("endue.database.object-privileges", {
        connection: "Dev",
        schema: "public",
        name: "orders",
        kind: "table",
      }),
    );
    const { el, act, update } = draw(state);
    const cell = el.querySelector<HTMLButtonElement>(
      'tr[data-grantee="reports"][data-column=""] [data-privilege="SELECT"]',
    );
    expect(cell?.dataset.state).toBe("option");
    expect(cell?.getAttribute("aria-label")).toBe(
      "SELECT to reports: granted with grant option; granted by app (with grant option)",
    );
    cell?.click();
    expect(act).toHaveBeenCalledWith("privilegesPress", "b-1", {
      grantee: "reports",
      column: "",
      privilege: "SELECT",
      now: "option",
    });
    update({
      ...state,
      edits: { "reports\u0000\u0000SELECT": "none", "ana\u0000\u0000SELECT": "granted" },
    } as never);
    const pressed = el.querySelector<HTMLButtonElement>(
      'tr[data-grantee="reports"][data-column=""] [data-privilege="SELECT"]',
    );
    expect(pressed?.dataset.state).toBe("none");
    expect(pressed?.classList.contains("pending")).toBe(true);
    expect(el.querySelector('[data-focus="review"]')?.textContent).toBe("Review 2 changes…");
    expect(el.querySelector(".privileges-policies")?.textContent).toContain("own_rows");
  });

  it("asks a role's password in a field that hides it, and shows the mask in the script", async () => {
    const { model } = await stateAfter((m) =>
      m.host
        .command("endue.database.create-role", { connection: "Dev", name: "zoe", login: true })
        .catch(() => {}),
    );
    const given = model();
    if (!given) throw new Error("the dialog was asked");
    const form = dialog?.render(document, given, () => {}) as HTMLFormElement;
    document.body.append(form);
    drawn.push(form);
    const password = form.querySelector<HTMLInputElement>('input[name="password"]');
    expect(password?.type).toBe("password");
    expect(password?.autocomplete).toBe("new-password");
    if (!password) return;
    password.value = "a secret";
    form.dispatchEvent(new Event("input"));
    const script = form.querySelector(".privileges-script")?.textContent ?? "";
    expect(script).toBe(`CREATE ROLE "zoe" WITH LOGIN PASSWORD ${MASK};`);
    expect(form.textContent).not.toContain("a secret");
  });
});
