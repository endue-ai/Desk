// The sampling settings as the inspector shows them: each slider's range, step and the value the
// servers use when the chat leaves it unset, then the token limit and the seed.
import { numberField, section, slider } from "./controls.js";
import { iconButton } from "./dom.js";

/**
 * @typedef {import("./chat-types.js").Sampling} Sampling
 * @typedef {{ key: keyof Sampling, label: string, hint: string, min: number, max: number, step: number, fallback: number, digits?: number }} SliderSpec
 */

/** @type {SliderSpec[]} */
export const SLIDERS = [
  {
    key: "temperature",
    label: "Temperature",
    hint: "Higher is more varied, lower more focused",
    min: 0,
    max: 2,
    step: 0.05,
    fallback: 0.8,
  },
  {
    key: "topP",
    label: "Top P",
    hint: "Keep the likeliest tokens up to this share",
    min: 0,
    max: 1,
    step: 0.01,
    fallback: 0.9,
  },
  {
    key: "topK",
    label: "Top K",
    hint: "Keep only this many likeliest tokens",
    min: 1,
    max: 200,
    step: 1,
    fallback: 40,
    digits: 0,
  },
  {
    key: "minP",
    label: "Min P",
    hint: "Drop tokens far less likely than the best",
    min: 0,
    max: 0.5,
    step: 0.01,
    fallback: 0.05,
  },
  {
    key: "repeatPenalty",
    label: "Repeat penalty",
    hint: "Above 1 discourages repeating itself",
    min: 0.8,
    max: 2,
    step: 0.01,
    fallback: 1.1,
  },
];

/** @param {Sampling} p @param {(key: keyof Sampling, value: unknown) => void} setParam */
export function samplingSection(p, setParam) {
  return section("Sampling", "sliders", [
    ...SLIDERS.map((s) =>
      slider({
        ...s,
        value: /** @type {number | undefined} */ (p[s.key]),
        onChange: (v) => setParam(s.key, v),
      }),
    ),
    numberField({
      label: "Max tokens",
      hint: "The longest answer; empty for no limit",
      value: p.maxTokens,
      min: 1,
      max: 1_000_000,
      onChange: (v) => setParam("maxTokens", v),
    }),
    numberField({
      label: "Seed",
      hint: "The same seed and settings give the same answer",
      value: p.seed,
      placeholder: "Random",
      extra: iconButton("refresh", "A new seed", () =>
        setParam("seed", Math.floor(Math.random() * 2 ** 31)),
      ),
      onChange: (v) => setParam("seed", v),
    }),
  ]);
}
