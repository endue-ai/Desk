import type { Connection } from "../ui/engines/common.js";
import type { OperationModel } from "../ui/features/objects/models.js";
import { fixtureScript } from "./fixtures";
import { mount, SAVED } from "./harness";
import { objectsServer } from "./objects-fixture";
import { catalogScript, type PgCatalog, shop } from "./pg-catalog";

export const [NOTES, SHOP] = SAVED as [Connection, Connection];
const DEV: Connection = { ...SHOP, id: "c-dev", name: "Dev", tag: "none" };
const LOCKED: Connection = { ...SHOP, id: "c-locked", name: "Locked", tag: "none", readOnly: true };

/** Run with what the dialog shows: its fields' values and the choices on. */
const asShown = (model: OperationModel) => ({
  values: Object.fromEntries(model.fields.map((f) => [f.name, f.value])),
  choices: model.choices.filter((c) => c.checked).map((c) => c.name),
});

export type Asked = { title: string; items: Array<{ id: string; label: string; detail?: string }> };

/** The shop with a materialized view in sales, and the plugin over it. */
export async function mounted(answer: (model: OperationModel) => unknown = asShown) {
  const model: PgCatalog = shop();
  model.sales?.tables?.push({
    name: "daily",
    kind: "m",
    columns: [
      ["person", "integer"],
      ["total", "numeric"],
    ],
  });
  const server = objectsServer(catalogScript(() => model, fixtureScript));
  const state = { menu: "", confirm: "yes" };
  const m = await mount({
    store: { connections: [DEV, SHOP, LOCKED, NOTES] },
    script: (sql, env) => {
      if (/^ALTER TABLE "public"\."people" RENAME TO "persons"$/u.test(sql.trim())) {
        const people = model.public?.tables?.find((t) => t.name === "people");
        if (people) people.name = "persons";
        (model.public as { mark: string }).mark = "10.4:400";
      }
      return server.script(sql, env);
    },
    pick: (asked: Asked) => (asked.title.startsWith("Run ") ? state.confirm : state.menu),
    dialog: (_type, given) => answer(given as OperationModel),
  });
  const selected: Array<[number, number]> = [];
  m.view.select = (start, end) => void selected.push([start, end]);
  return { m, server, model, state, selected };
}
