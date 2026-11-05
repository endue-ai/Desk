/**
 * The design system's catalogue (ADR 0090, docs/ko/design-system-requirements.md DH-03): every component
 * a design system shapes, its properties, their named options and the endue design system's choice
 * (today's look). Properties share a vocabulary (`shape` is always none to full, `size` always xs to
 * lg), each list a named enum of `specs/plugin/v0/design-system.schema.json`; a test keeps the two
 * equal. A recipe names options only: values stay the theme's.
 */

/** The option lists, by the name of their enum in the spec. */
export const VOCABULARY = {
  DesignShape: ["none", "sm", "md", "lg", "full"],
  DesignSize: ["xs", "sm", "md", "lg"],
  DesignElevation: ["none", "sm", "md", "lg"],
  DesignPadding: ["tight", "normal", "roomy"],
  DesignCase: ["none", "uppercase"],
  DesignWeight: ["regular", "medium", "semibold", "bold"],
  DesignTone: ["solid", "soft", "outline"],
  DesignFill: ["outline", "soft", "ghost"],
  DesignFieldStyle: ["outline", "filled", "underline"],
  DesignFieldFocus: ["ring", "border"],
  DesignCheckAccent: ["primary", "text"],
  DesignTabsStyle: ["boxed", "pill", "underline"],
  DesignCardStyle: ["outline", "elevated", "filled", "plain"],
  DesignRowSelection: ["fill", "soft", "bar"],
  DesignMenuBorder: ["outline", "none"],
  DesignScrim: ["blur", "dim"],
  DesignToastStyle: ["outline", "soft", "inverse"],
  DesignBadgeStyle: ["soft", "solid", "outline"],
  DesignTableRows: ["lines", "striped", "plain"],
  DesignTableHeader: ["muted", "plain"],
  DesignThickness: ["thin", "normal", "thick"],
  DesignFocusOffset: ["none", "near", "far"],
} as const;

type Vocabulary = typeof VOCABULARY;
type Word = keyof Vocabulary;
type Spec<W extends Word = Word> = { readonly enum: W; readonly default: Vocabulary[W][number] };
const p = <W extends Word>(word: W, choice: Vocabulary[W][number]): Spec<W> => ({
  enum: word,
  default: choice,
});

export const CATALOGUE = {
  button: {
    shape: p("DesignShape", "md"),
    size: p("DesignSize", "sm"),
    weight: p("DesignWeight", "medium"),
    case: p("DesignCase", "none"),
    padding: p("DesignPadding", "normal"),
    primary: p("DesignTone", "solid"),
    secondary: p("DesignFill", "outline"),
    elevation: p("DesignElevation", "none"),
  },
  iconButton: {
    shape: p("DesignShape", "md"),
    size: p("DesignSize", "md"),
    style: p("DesignFill", "ghost"),
  },
  field: {
    style: p("DesignFieldStyle", "outline"),
    shape: p("DesignShape", "md"),
    size: p("DesignSize", "md"),
    focus: p("DesignFieldFocus", "ring"),
  },
  check: { accent: p("DesignCheckAccent", "primary"), size: p("DesignSize", "md") },
  tabs: {
    style: p("DesignTabsStyle", "boxed"),
    shape: p("DesignShape", "md"),
    size: p("DesignSize", "sm"),
  },
  card: {
    style: p("DesignCardStyle", "outline"),
    shape: p("DesignShape", "md"),
    padding: p("DesignPadding", "normal"),
  },
  row: {
    selection: p("DesignRowSelection", "fill"),
    shape: p("DesignShape", "md"),
    size: p("DesignSize", "sm"),
  },
  menu: {
    shape: p("DesignShape", "md"),
    elevation: p("DesignElevation", "md"),
    border: p("DesignMenuBorder", "outline"),
  },
  dialog: {
    shape: p("DesignShape", "lg"),
    elevation: p("DesignElevation", "lg"),
    scrim: p("DesignScrim", "blur"),
    padding: p("DesignPadding", "roomy"),
  },
  toast: {
    style: p("DesignToastStyle", "outline"),
    shape: p("DesignShape", "lg"),
    elevation: p("DesignElevation", "md"),
  },
  badge: {
    style: p("DesignBadgeStyle", "soft"),
    shape: p("DesignShape", "full"),
    case: p("DesignCase", "none"),
  },
  tooltip: { shape: p("DesignShape", "md"), elevation: p("DesignElevation", "sm") },
  table: {
    rows: p("DesignTableRows", "lines"),
    header: p("DesignTableHeader", "muted"),
    size: p("DesignSize", "sm"),
  },
  progress: { thickness: p("DesignThickness", "normal"), shape: p("DesignShape", "full") },
  focus: { width: p("DesignThickness", "normal"), offset: p("DesignFocusOffset", "near") },
} as const;

export type Catalogue = typeof CATALOGUE;
export type ComponentName = keyof Catalogue;
export type PropertyName<C extends ComponentName> = keyof Catalogue[C] & string;
export type OptionOf<C extends ComponentName, P extends PropertyName<C>> = Catalogue[C][P] extends {
  enum: infer W extends Word;
}
  ? Vocabulary[W][number]
  : never;

/** A component's choices: any property left out keeps its default. */
export type ComponentRecipe<C extends ComponentName> = {
  [P in PropertyName<C>]?: OptionOf<C, P>;
};

/** What a design system's `components` holds: any component left out keeps its defaults. */
export type DesignRecipe = { [C in ComponentName]?: ComponentRecipe<C> };

/** Every component with every property chosen. */
export type FullRecipe = { [C in ComponentName]: Required<ComponentRecipe<C>> };

/** The components in the order the studio shows them. */
export const COMPONENTS = Object.keys(CATALOGUE) as ComponentName[];

const specOf = (component: string, property: string): Spec | undefined =>
  (CATALOGUE as unknown as Record<string, Record<string, Spec>>)[component]?.[property];

/** A component's properties in catalogue order. */
export function propertiesOf<C extends ComponentName>(component: C): PropertyName<C>[] {
  return Object.keys(CATALOGUE[component]) as PropertyName<C>[];
}

/** A property's options in vocabulary order. */
export function optionsOf(component: string, property: string): readonly string[] {
  const spec = specOf(component, property);
  return spec ? VOCABULARY[spec.enum] : [];
}

/** A property's choice in the endue design system. */
export function defaultOf(component: string, property: string): string | undefined {
  return specOf(component, property)?.default;
}

/** The endue design system: every property at its default. */
export function defaultRecipe(): FullRecipe {
  const out: Record<string, Record<string, string>> = {};
  for (const component of COMPONENTS) {
    const props: Record<string, string> = {};
    for (const property of propertiesOf(component)) {
      props[property] = defaultOf(component, property) as string;
    }
    out[component] = props;
  }
  return out as FullRecipe;
}

/**
 * `recipe` over the defaults, keeping only known components, properties and options: what a brain,
 * a file or a hand gives may say more or less, and the rest is dropped (DH-03).
 */
export function fillRecipe(recipe: unknown): FullRecipe {
  const full = defaultRecipe() as unknown as Record<string, Record<string, string>>;
  if (!recipe || typeof recipe !== "object") return full as unknown as FullRecipe;
  for (const [component, props] of Object.entries(recipe as Record<string, unknown>)) {
    const target = full[component];
    if (!target || !props || typeof props !== "object") continue;
    for (const [property, value] of Object.entries(props as Record<string, unknown>)) {
      if (typeof value === "string" && optionsOf(component, property).includes(value)) {
        target[property] = value;
      }
    }
  }
  return full as unknown as FullRecipe;
}

/** Only the choices that differ from the defaults: what a saved design system needs to say. */
export function trimRecipe(recipe: unknown): DesignRecipe {
  const full = fillRecipe(recipe) as unknown as Record<string, Record<string, string>>;
  const out: Record<string, Record<string, string>> = {};
  for (const component of COMPONENTS) {
    for (const [property, value] of Object.entries(full[component] ?? {})) {
      if (defaultOf(component, property) === value) continue;
      out[component] ??= {};
      out[component][property] = value;
    }
  }
  return out as DesignRecipe;
}
