// The code dialog's body: the languages on the left, the request as code on the right (coloured
// where the language is one the studio colours), a switch that shows or hides secrets, and copy.

import { GENERATORS, hideSecrets } from "./codegen.js";
import { button, h } from "./dom.js";
import { paint, runs } from "./highlight.js";
import { SECRET_HEADERS } from "./send.js";

/** @param {import("./curl-config.js").Prepared} prep @param {{ missing: string[], onCopy(text: string): void }} opts */
export function codeGen(prep, opts) {
  let chosen = "curl";
  let showSecrets = false;
  const code = h("pre.as-gen-code");
  const list = h("div.as-gen-langs", { role: "listbox", "aria-label": "Languages" });
  const secrets = /** @type {HTMLInputElement} */ (
    h("input.desk-check", { type: "checkbox", "aria-label": "Show secrets" })
  );
  const text = () => {
    const gen = GENERATORS[chosen] ?? GENERATORS.curl;
    return gen ? gen.make(showSecrets ? prep : hideSecrets(prep, SECRET_HEADERS)) : "";
  };
  const draw = () => {
    list.replaceChildren(
      ...Object.entries(GENERATORS).map(([id, g]) =>
        h(
          `button.desk-row.as-gen-lang${id === chosen ? ".is-selected" : ""}`,
          {
            type: "button",
            role: "option",
            "aria-selected": String(id === chosen),
            onClick: () => {
              chosen = id;
              draw();
            },
          },
          g.label,
        ),
      ),
    );
    paint(code, runs(text(), GENERATORS[chosen]?.lang ?? "text"));
  };
  secrets.addEventListener("change", () => {
    showSecrets = secrets.checked;
    draw();
  });
  draw();
  return h(
    "div.as-gen",
    null,
    list,
    h(
      "div.as-gen-main",
      null,
      h(
        "div.as-gen-bar",
        null,
        h("label.as-gen-secret", null, secrets, h("span", null, "Show secrets")),
        opts.missing.length
          ? h("span.as-hint.as-bad", null, `Not defined: ${opts.missing.join(", ")}`)
          : null,
        h("span.as-grow"),
        button({
          label: "Copy",
          icon: "copy",
          kind: "desk-btn-primary",
          onClick: () => opts.onCopy(text()),
        }),
      ),
      code,
    ),
  );
}
