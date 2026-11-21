// @vitest-environment jsdom
// The dialog of an operation on an object (PG-52, ui/features/objects/dialog.js): where it runs with
// its environment tag, what depends on the object, the exact script written again as the person
// types and chooses, a script the answers cannot make said in its place with Run waiting, and the
// answers it gives (nothing on Cancel).
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { operationDialog } from "../ui/features/objects/dialog.js";
import { modelOf } from "../ui/features/objects/models.js";

const PROD: Connection = {
  id: "c-prod",
  name: "Shop",
  engine: "postgresql",
  host: "db.example",
  port: 5432,
  database: "shop",
  user: "app",
  ssl: "default",
  sslCa: "",
  file: "",
  tag: "production",
  readOnly: false,
};
const orders = { kind: "table", schema: "public", name: "orders" };

function drawn(model: ReturnType<typeof modelOf>) {
  const answers: unknown[] = [];
  const form = operationDialog(document, model, (answer?: unknown) => void answers.push(answer));
  document.body.replaceChildren(form);
  const script = () => form.querySelector("#object-script")?.textContent;
  const run = form.querySelector<HTMLButtonElement>("button[type=submit]");
  return { form, answers, script, run };
}

describe("the object operation dialog", () => {
  it("shows the dependents and writes the script again as CASCADE is chosen", () => {
    const facts = {
      dependents: {
        blocking: [{ kind: "view", name: "public.big_orders" }],
        along: [{ kind: "table constraint", name: "orders_pkey on public.orders" }],
        more: 3,
      },
    };
    const { form, answers, script, run } = drawn(modelOf(PROD, "drop", orders, facts, {}));
    expect(form.querySelector("h2")?.textContent).toBe("Drop table public.orders");
    expect(form.querySelector(".object-where")?.textContent).toBe("Shop · PostgreSQLproduction");
    expect(form.querySelector(".tag-production")).not.toBeNull();
    const depends = form.querySelector(".object-depends");
    expect(depends?.querySelector("h3")?.textContent).toBe(
      "1 object depends on it: CASCADE drops it too",
    );
    expect([...(depends?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
      "view public.big_orders",
      "table constraint orders_pkey on public.orders",
    ]);
    expect(depends?.textContent).toContain("and 3 more");
    expect(script()).toBe('DROP TABLE "public"."orders";');
    expect(run?.className).toContain("desk-btn-danger");
    expect(run?.textContent).toBe("Drop");

    const cascade = form.querySelector<HTMLInputElement>("input[name=cascade]");
    expect(cascade?.checked).toBe(false);
    if (cascade) cascade.checked = true;
    cascade?.dispatchEvent(new Event("change", { bubbles: true }));
    expect(script()).toBe('DROP TABLE "public"."orders" CASCADE;');
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(answers).toEqual([{ values: {}, choices: ["cascade"] }]);
  });

  it("says why there is no script, waits, and answers nothing on Cancel", () => {
    const { form, answers, script, run } = drawn(
      modelOf(PROD, "rename", orders, {}, { to: "orders" }),
    );
    const problem = form.querySelector<HTMLElement>(".object-problem");
    expect(script()).toBe("");
    expect(problem?.textContent).toBe("That is its name now: type another.");
    expect(problem?.hidden).toBe(false);
    expect(run?.disabled).toBe(true);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(answers).toEqual([]);

    const name = form.querySelector<HTMLInputElement>("input[name=to]");
    if (name) name.value = "Orders 2026";
    name?.dispatchEvent(new Event("input", { bubbles: true }));
    expect(script()).toBe('ALTER TABLE "public"."orders" RENAME TO "Orders 2026";');
    expect(problem?.hidden).toBe(true);
    expect(run?.disabled).toBe(false);
    expect(run?.className).toContain("desk-btn-primary");
    form.querySelector<HTMLButtonElement>("button[type=button]")?.click();
    expect(answers).toEqual([undefined]);
  });

  it("lists the roles for a new owner and the notes of a materialized view's source", () => {
    const owner = drawn(
      modelOf(PROD, "owner", orders, { owner: "app", roles: ["app", "reports"] }, {}),
    );
    expect(
      [...owner.form.querySelectorAll("datalist option")].map((o) => o.getAttribute("value")),
    ).toEqual(["app", "reports"]);
    expect(owner.form.querySelector(".object-note")?.textContent).toBe("app owns it now.");
    expect(owner.run?.disabled).toBe(true);

    const daily = { kind: "materialized view", schema: "sales", name: "daily" };
    const text = 'CREATE MATERIALIZED VIEW "sales"."daily" AS\nSELECT 1\nWITH DATA;\n';
    const apply = drawn(modelOf(PROD, "apply", daily, { text }, {}));
    expect(apply.script()).toBe(`DROP MATERIALIZED VIEW "sales"."daily";\n${text}`);
    expect([...apply.form.querySelectorAll(".object-note")].map((n) => n.textContent)).toContain(
      "Its grants are not kept: grant them again after.",
    );
  });
});
