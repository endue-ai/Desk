/**
 * The editor's controls, each a labelled row that reports its new value: a colour (picker and text,
 * so rgba() and oklch() stay editable), a range, a choice, a text and a file. Every control has a
 * visible label, which screen readers read too.
 */
import { formatColor, parseColor } from "@endue-ai/ui/theme";
import { h } from "../shell/dom";

let next = 0;
const fieldId = () => `theme-field-${++next}`;

const row = (label: string, id: string, ...controls: HTMLElement[]) =>
  h(
    "div",
    { class: "theme-field" },
    h("label", { class: "theme-field-label", for: id }, label),
    h("span", { class: "theme-field-controls" }, controls),
  );

/** A colour: the picker shows its opaque part, the text keeps the whole value. */
export function colorField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  key: string,
): HTMLElement {
  const id = fieldId();
  const parsed = parseColor(value);
  const hex = parsed ? formatColor([parsed[0], parsed[1], parsed[2], 1]) : "#000000";
  const text = h("input", {
    class: "theme-field-text",
    type: "text",
    value,
    "aria-label": `${label} (CSS)`,
    "data-key": `${key}-text`,
    spellcheck: "false",
    onChange: () => parseColor(text.value) && onChange(text.value.trim()),
  });
  const picker = h("input", {
    class: "theme-field-color",
    type: "color",
    id,
    value: hex,
    "data-key": key,
    onInput: () => {
      text.value = picker.value;
      onChange(picker.value);
    },
  });
  return row(label, id, picker, text);
}

/** A number on a slider, with its value beside it. */
export function rangeField(
  label: string,
  options: { min: number; max: number; step: number; value: number; unit?: string },
  onChange: (value: number) => void,
  key: string,
): HTMLElement {
  const id = fieldId();
  const out = h(
    "output",
    { class: "theme-field-value", for: id },
    show(options.value, options.unit),
  );
  const input = h("input", {
    type: "range",
    id,
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
    "data-key": key,
    onInput: () => {
      out.textContent = show(Number(input.value), options.unit);
      onChange(Number(input.value));
    },
  });
  return row(label, id, input, out);
}

const show = (value: number, unit = "") => `${Math.round(value * 1000) / 1000}${unit}`;

/** One of a few named values. */
export function choiceField(
  label: string,
  choices: ReadonlyArray<readonly [string, string]>,
  value: string,
  onChange: (value: string) => void,
  key: string,
): HTMLElement {
  const id = fieldId();
  const select = h(
    "select",
    { id, "data-key": key, onChange: () => onChange(select.value) },
    choices.map(([v, text]) => h("option", { value: v }, text)),
  );
  select.value = value;
  return row(label, id, select);
}

/** Free text, reported when it is left or Enter is pressed. */
export function textField(
  label: string,
  value: string,
  onChange: (value: string) => void,
  key: string,
  placeholder = "",
): HTMLElement {
  const id = fieldId();
  const input = h("input", {
    type: "text",
    id,
    value,
    placeholder,
    spellcheck: "false",
    "data-key": key,
    onChange: () => onChange(input.value),
  });
  return row(label, id, input);
}

/** A file from disk, read whole: its name and bytes. */
export function fileField(
  label: string,
  accept: string,
  onFile: (name: string, bytes: Uint8Array) => void,
  key: string,
): HTMLElement {
  const id = fieldId();
  const input = h("input", {
    type: "file",
    id,
    accept,
    "data-key": key,
    onChange: async () => {
      const file = input.files?.[0];
      if (!file) return;
      onFile(file.name, new Uint8Array(await file.arrayBuffer()));
      input.value = "";
    },
  });
  return row(label, id, input);
}

/** Bytes as base64, and as a data: URL a preview can load. */
export function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
