// brain-echo's propose_theme: a theme from the words it recognises in a sentence, in English or in
// Korean, so describing a theme runs and is tested without endue AI. The answer is the tool's
// arguments, { name, description, theme }, where theme is a theme block (ThemePackage in
// specs/plugin/v0/theme.schema.json). Only the prompt's last line is read: the person's sentence comes
// after whatever else the caller sends. The same sentence always gives the same theme.

// Role colours per palette and scheme (the desk's token names in camelCase): background, card,
// muted, text, textMuted, primary, primaryForeground and border, in that order.
const role = (values) => {
  const [background, card, muted, text, textMuted, primary, primaryForeground, border] =
    values.split(" ");
  return {
    background,
    card,
    muted,
    text,
    textMuted,
    primary,
    primaryForeground,
    primaryText: primary,
    border,
    ring: primary,
  };
};

const PALETTES = {
  plain: {
    light: role("#f7f7f8 #ffffff #eeeef1 #18181b #5f5f6b #4f5bd5 #ffffff #dcdce2"),
    dark: role("#111214 #18191c #1f2024 #ececf1 #a1a1aa #8b98ff #0b0c10 #2c2d33"),
  },
  warm: {
    light: role("#f6f1e7 #fbf7ef #ede4d3 #2a2118 #6b5d4c #9a4a12 #fff8ee #d9c9a8"),
    dark: role("#1c1612 #241c16 #2e241c #f3e8d8 #bfae96 #e0913a #1c1612 #4a3a2c"),
  },
  amber: {
    light: role("#fff7e6 #fffbf2 #fbe9c4 #3a2600 #7a5a1a #9a5c00 #fffaf0 #e6c88a"),
    dark: role("#0f0a03 #160f05 #21170a #ffcc66 #c99a3e #ffb000 #0f0a03 #4a3510"),
  },
  ocean: {
    light: role("#eef6fb #f8fcfe #dcebf4 #0f2433 #4a6578 #0b6e99 #f4fbff #b8d3e3"),
    dark: role("#08151f #0d1e2b #132a3a #dcefff #8fb0c6 #38bdf8 #04121b #1f3d52"),
  },
  forest: {
    light: role("#f1f5ee #f9fbf7 #e1eadb #17251a #4f6352 #2f6b3a #f3faf3 #c3d4bd"),
    dark: role("#0d1610 #132017 #1a2b1f #e1efe2 #9db8a2 #6fbf73 #0a140c #29402f"),
  },
  pastel: {
    light: role("#fbf7fc #ffffff #f1e9f5 #2e2433 #6e6175 #8e5bb5 #ffffff #e2d4ea"),
    dark: role("#1d1a22 #25212b #2e2935 #f3eaf8 #bcaec6 #d4b0f0 #1d1a22 #403849"),
  },
};

// The terminal's sixteen ANSI colours, black to bright white.
const ANSI = {
  amber: (
    "#1a1206 #b35900 #cc7a00 #e69500 #995c00 #b36b00 #cc8800 #ffcc66 " +
    "#4a3510 #ff8c1a #ffa31a #ffbf33 #e6a23c #ffb347 #ffc966 #ffe0a3"
  ).split(" "),
  dark: (
    "#1b1d23 #e06c75 #98c379 #e5c07b #61afef #c678dd #56b6c2 #abb2bf " +
    "#5c6370 #ef7f88 #a9d18e #f0cd8a #7cbcf2 #d291e4 #6cc4cf #e6e6e6"
  ).split(" "),
  light: (
    "#2e3138 #c4323c #3f8f2f #a86f00 #2f6fc4 #9a3fb5 #1f8a92 #c9ccd2 " +
    "#6b6f78 #d9434d #4ea33c #bf8200 #3f82d9 #ae52c9 #2a9fa8 #f2f3f5"
  ).split(" "),
};

const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';
const SERIF = 'Georgia, "Times New Roman", serif';

// What each word does, in the order the traits apply (a later trait wins a layer it sets).
// label: the word in the theme's name; palette: the colours; scheme: the scheme it asks for.
const TRAITS = [
  {
    tag: "warm",
    label: "Warm",
    palette: "warm",
    en: ["warm", "cozy", "sunset"],
    ko: ["따뜻", "포근", "노을"],
  },
  {
    tag: "amber",
    label: "Amber",
    palette: "amber",
    en: ["amber", "orange", "retro"],
    ko: ["호박", "앰버", "주황", "레트로"],
  },
  {
    tag: "ocean",
    label: "Ocean",
    palette: "ocean",
    en: ["ocean", "sea", "blue", "wave"],
    ko: ["바다", "파도", "파란", "푸른"],
  },
  {
    tag: "forest",
    label: "Forest",
    palette: "forest",
    en: ["forest", "green", "moss", "leaf"],
    ko: ["숲", "초록", "이끼", "나무"],
  },
  {
    tag: "pastel",
    label: "Pastel",
    palette: "pastel",
    scheme: "light",
    en: ["pastel", "candy"],
    ko: ["파스텔", "사탕"],
    shape: { radius: "round", density: "spacious" },
  },
  {
    tag: "night",
    label: "Night",
    scheme: "dark!",
    en: ["night", "dark", "midnight"],
    ko: ["밤", "어두운", "어둠", "심야"],
    glow: true,
  },
  { tag: "light", scheme: "light!", en: ["light", "bright", "day"], ko: ["밝은", "환한"] },
  {
    tag: "paper",
    label: "Paper",
    scheme: "light",
    en: ["paper", "ink", "print"],
    ko: ["종이", "잉크", "인쇄"],
    type: { sans: SERIF },
    shape: { radius: "soft" },
    motion: "calm",
    material: { noise: 0.06, shadow: "soft" },
  },
  {
    tag: "grain",
    en: ["texture", "textured", "grain", "grainy", "noise"],
    ko: ["질감", "거친", "입자"],
    material: { noise: 0.1 },
  },
  {
    tag: "glass",
    label: "Glass",
    en: ["glass", "frosted", "translucent"],
    ko: ["유리", "투명"],
    shape: { radius: "round" },
    motion: "smooth",
    material: { opacity: 0.78, blur: 16, shadow: "strong" },
    gradient: true,
  },
  {
    tag: "terminal",
    label: "Terminal",
    scheme: "dark",
    en: ["terminal", "console", "crt", "hacker", "code"],
    ko: ["터미널", "콘솔", "코드"],
    type: { sans: MONO, mono: MONO },
    shape: { radius: "none", density: "compact" },
    motion: "snappy",
    material: { shadow: "none", border: 1 },
    terminal: true,
  },
  { tag: "calm", en: ["calm", "quiet", "slow"], ko: ["차분", "조용", "느긋"], motion: "calm" },
  { tag: "snappy", en: ["snappy", "fast", "quick"], ko: ["빠른", "경쾌"], motion: "snappy" },
  {
    tag: "compact",
    en: ["compact", "dense", "tight"],
    ko: ["촘촘", "빽빽"],
    shape: { density: "compact" },
  },
  {
    tag: "spacious",
    en: ["spacious", "airy", "roomy"],
    ko: ["넉넉", "여유", "널찍"],
    shape: { density: "spacious" },
  },
  {
    tag: "round",
    en: ["round", "rounded", "bubbly"],
    ko: ["둥근", "동글"],
    shape: { radius: "round" },
  },
  {
    tag: "square",
    en: ["square", "sharp", "angular"],
    ko: ["각진", "네모"],
    shape: { radius: "none" },
  },
];

/** The traits a sentence names: English by whole word (or its plural), Korean by stem. */
export function recognise(sentence) {
  const lower = sentence.toLowerCase();
  const words = new Set(lower.match(/[a-z]+/g) ?? []);
  const said = (word) => words.has(word) || words.has(`${word}s`);
  return TRAITS.filter((t) => t.en.some(said) || t.ko.some((stem) => lower.includes(stem)));
}

/** dark! and light! are what the person asked for; otherwise the traits lean, and the desk is dark. */
function schemeOf(traits) {
  const asks = traits.map((t) => t.scheme).filter(Boolean);
  if (asks.includes("dark!")) return "dark";
  if (asks.includes("light!")) return "light";
  const light = asks.filter((s) => s === "light").length;
  return light > asks.filter((s) => s === "dark").length ? "light" : "dark";
}

const withAlpha = (hex, alpha) => `${hex}${alpha}`;

/** propose_theme's arguments for `prompt`. */
export function proposeTheme(prompt) {
  const lines = String(prompt)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sentence = (lines.at(-1) ?? "").slice(0, 2000);
  const traits = recognise(sentence);
  const scheme = schemeOf(traits);
  const palette = PALETTES[traits.find((t) => t.palette)?.palette ?? "plain"][scheme];

  const type = {};
  const shape = { radius: "soft", density: "comfortable" };
  let motion = "smooth";
  const material = {};
  for (const trait of traits) {
    Object.assign(type, trait.type);
    Object.assign(shape, trait.shape);
    Object.assign(material, trait.material);
    motion = trait.motion ?? motion;
  }

  const gradient = traits.some((t) => t.gradient)
    ? [palette.muted, palette.background, withAlpha(palette.primary, "40")]
    : [palette.background, palette.muted];
  const backdrop = { gradient, angle: traits.some((t) => t.gradient) ? 135 : 180 };
  if (traits.some((t) => t.glow)) backdrop.glow = withAlpha(palette.primary, "33");

  const variant = { colors: { ...palette }, backdrop };
  if (Object.keys(material).length > 0) variant.material = material;
  if (traits.some((t) => t.terminal)) {
    const amber = traits.some((t) => t.palette === "amber");
    variant.terminal = { ansi: amber ? ANSI.amber : ANSI[scheme] };
  }

  const theme = {
    author: "brain-echo",
    license: "CC0-1.0",
    preview: [palette.background, palette.primary, palette.text, palette.muted, palette.border],
    shape,
    motion: { personality: motion },
    [scheme]: variant,
  };
  if (sentence) theme.origin = { prompt: sentence };
  const tags = traits.map((t) => t.tag);
  if (tags.length > 0) theme.tags = tags;
  if (Object.keys(type).length > 0) theme.type = type;

  const labels = traits.filter((t) => t.label).map((t) => t.label);
  const name = labels.length > 0 ? labels.slice(0, 3).join(" ") : "Echo";
  const description =
    tags.length > 0
      ? `A ${scheme} theme brain-echo made from: ${tags.join(", ")}.`
      : `brain-echo recognised no words in that, so here is a plain ${scheme} theme.`;
  return { name, description, theme };
}
