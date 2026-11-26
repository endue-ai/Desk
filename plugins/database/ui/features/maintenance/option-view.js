// The maintenance panel's option fields and their disabled explanations.
import { el } from "../../dom.js";
import { t as messageText } from "../../strings/index.js";

/**
 * @typedef {import("./controller.js").MaintenanceState} MaintenanceState
 * @typedef {import("./options.js").Offer} Offer
 */

const SWITCH = {
  get ""() {
    return messageText("maintenance.switch.table");
  },
  get auto() {
    return messageText("maintenance.switch.auto");
  },
  get on() {
    return messageText("maintenance.switch.on");
  },
  get off() {
    return messageText("maintenance.switch.off");
  },
};

/** One option's control, its label, and why it does not apply when it does not. */
export function optionOf(
  /** @type {Document} */ doc,
  /** @type {Offer} */ offer,
  /** @type {MaintenanceState} */ s,
  /** @type {(key: string, value: unknown) => void} */ set,
) {
  const value = s.options[offer.key];
  const off = offer.why !== "" || s.run?.status === "running";
  const attrs = { "data-key": offer.key, ...(off ? { disabled: true } : {}) };
  const why = offer.why ? el(doc, "span", { class: "maint-why" }, offer.why) : undefined;
  if (offer.type === "check") {
    const input = /** @type {HTMLInputElement} */ (
      el(doc, "input", { type: "checkbox", class: "desk-check", ...attrs })
    );
    input.checked = value === true;
    input.addEventListener("change", () => set(offer.key, input.checked));
    return el(doc, "label", { class: "maint-option" }, input, ` ${offer.label}`, why);
  }
  /** @type {HTMLInputElement | HTMLSelectElement} */
  let field;
  if (offer.type === "switch" || offer.type === "pick") {
    const none =
      offer.key === "tablespace"
        ? messageText("features.maintenance.panel.whereTheyAre")
        : offer.key === "using"
          ? messageText("features.maintenance.panel.pickOne")
          : "";
    field = /** @type {HTMLSelectElement} */ (
      el(
        doc,
        "select",
        { class: "desk-field", ...attrs },
        ...offer.values.map((v) =>
          el(
            doc,
            "option",
            { value: v },
            offer.type === "switch" ? SWITCH[/** @type {keyof typeof SWITCH} */ (v)] : v || none,
          ),
        ),
      )
    );
    field.value = String(value ?? "");
  } else {
    const number = offer.type === "number";
    field = /** @type {HTMLInputElement} */ (
      el(doc, "input", {
        class: "desk-field",
        ...(number
          ? {
              type: "number",
              min: "0",
              max: "1024",
              placeholder: messageText("features.maintenance.panel.serverDecides"),
            }
          : { placeholder: messageText("features.maintenance.panel.kb") }),
        ...attrs,
      })
    );
    field.value = value === null ? "" : String(value);
  }
  field.addEventListener("change", () => set(offer.key, field.value));
  return el(doc, "label", { class: "maint-option maint-field" }, `${offer.label} `, field, why);
}
