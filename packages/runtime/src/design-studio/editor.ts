/**
 * The design system editor (DS-03): every component's properties as choices, the whole desk previewing
 * the draft as it changes, and Save as the person's own design system (`local.<name>`, theme.save). A
 * copy of the person's own keeps its id; any other becomes a new one. The studio docks to the right
 * while it is open, so the desk shows what it previews.
 */
import type { DesignSystemPackage } from "@endue-ai/bridge";
import {
  COMPONENTS,
  defaultOf,
  type FullRecipe,
  fillRecipe,
  optionsOf,
  propertiesOf,
  trimRecipe,
} from "@endue-ai/ui/design";
import { localDesignId, type RuntimeDesigns } from "../policies/design";
import { h } from "../shell/dom";
import type { StudioLang } from "../theme-studio/copy";
import { type DesignCopy, designText, partLabel } from "./copy";

export interface DesignEditorDeps {
  designs: RuntimeDesigns;
  lang(): StudioLang;
  /** Back to the gallery, with the design system just saved selected. */
  back(id?: string): void;
}

export interface DesignEditor {
  readonly element: HTMLElement;
  /** Tune a copy of `from` (installed, or "" the endue one), or of a draft a sentence or market gave. */
  start(from: string, made?: { name?: string; designSystem: DesignSystemPackage }): void;
  stop(): void;
}

export function createDesignEditor(deps: DesignEditorDeps): DesignEditor {
  const { designs } = deps;
  const tr = (key: DesignCopy) => designText(deps.lang(), key);
  let recipe: FullRecipe = fillRecipe({});
  let from = "";
  let meta: DesignSystemPackage = { components: {} };
  const name = h("input", { class: "input", type: "text", "data-key": "design-name" });
  const description = h("input", {
    class: "input",
    type: "text",
    "data-key": "design-description",
  });
  const note = h("p", { class: "theme-note", "aria-live": "polite" });
  const sections = h("div", { class: "design-editor-sections" });
  const element = h("div", { class: "design-editor" });

  const draft = (): DesignSystemPackage => ({
    ...meta,
    ...(from ? { origin: { ...meta.origin, base: from } } : {}),
    components: trimRecipe(recipe),
  });
  const preview = () => designs.previewDraft(draft());

  const choice = (component: string, property: string) => {
    const value = (recipe as unknown as Record<string, Record<string, string>>)[component]?.[
      property
    ];
    const select = h(
      "select",
      {
        class: "input design-editor-select",
        "data-key": `${component}.${property}`,
        onChange: () => {
          const next = recipe as unknown as Record<string, Record<string, string>>;
          if (next[component]) next[component][property] = select.value;
          preview();
        },
      },
      optionsOf(component, property).map((option) =>
        h(
          "option",
          { value: option, ...(option === value ? { selected: true } : {}) },
          option === defaultOf(component, property) ? `${option} ·` : option,
        ),
      ),
    );
    return h(
      "label",
      { class: "design-editor-choice" },
      h("span", { class: "field-label" }, partLabel(deps.lang(), property)),
      select,
    );
  };

  const draw = () => {
    sections.replaceChildren(
      ...COMPONENTS.map((component) =>
        h(
          "fieldset",
          { class: "design-editor-component" },
          h("legend", {}, partLabel(deps.lang(), component)),
          propertiesOf(component).map((property) => choice(component, property)),
        ),
      ),
    );
  };

  const save = async () => {
    const own = from.startsWith("local.") && designs.installed().some((d) => d.id === from);
    const title = name.value.trim() || tr("myDesign");
    const taken = (id: string) => designs.installed().some((d) => d.id === id);
    const id = own ? from : localDesignId(title, taken);
    const text = description.value.trim();
    try {
      await designs.io().save({
        id,
        name: title,
        ...(text ? { description: text } : {}),
        designSystem: draft(),
      });
      designs.previewDraft(undefined);
      designs.apply(id);
      note.textContent = `${tr("saved")}: ${title}`;
      deps.back(id);
    } catch (error) {
      note.textContent = `${tr("failed")}: ${error instanceof Error ? error.message : String(error)}`;
    }
  };

  element.append(
    h(
      "div",
      { class: "design-editor-meta" },
      h(
        "label",
        { class: "design-editor-choice" },
        h("span", { class: "field-label" }, tr("name")),
        name,
      ),
      h(
        "label",
        { class: "design-editor-choice" },
        h("span", { class: "field-label" }, tr("description")),
        description,
      ),
    ),
    sections,
    note,
    h(
      "div",
      { class: "theme-gallery-actions design-editor-actions" },
      h(
        "button",
        {
          type: "button",
          class: "btn btn-primary",
          "data-key": "design-save",
          onClick: () => void save(),
        },
        tr("save"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-outline",
          "data-key": "design-reset",
          onClick: () => {
            recipe = fillRecipe({});
            draw();
            preview();
          },
        },
        tr("reset"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-outline",
          "data-key": "design-back",
          onClick: () => deps.back(),
        },
        tr("back"),
      ),
    ),
  );

  return {
    element,
    start(id, made) {
      const installed = designs.installed().find((d) => d.id === id);
      from = made ? "" : id;
      meta = made?.designSystem ?? installed?.designSystem ?? { components: {} };
      recipe = fillRecipe(made?.designSystem.components ?? designs.resolve(id).recipe);
      const own = id.startsWith("local.") && installed !== undefined && !made;
      name.value =
        made?.name ?? (own ? (installed?.name ?? "") : installed ? `${installed.name} (copy)` : "");
      description.value = own ? (installed?.description ?? "") : "";
      note.textContent = "";
      draw();
      preview();
    },
    stop() {
      designs.previewDraft(undefined);
    },
  };
}
