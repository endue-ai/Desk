/** The design system studio's words, in the shell's two languages (docs/ko/design-system-requirements.md DS). */
import { messageText } from "@endue-ai/bridge";
import { type KeyOf, moduleText } from "../i18n/messages";
import type { StudioLang } from "../theme-studio/copy";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

const text = moduleText("designStudio", { en, ko });

export type DesignCopy = Exclude<KeyOf<keyof typeof en, "designStudio">, `part.${string}`>;

export function designText(lang: StudioLang, key: DesignCopy): string {
  return text(lang, key);
}

/** A component's or property's label: from the catalog (designStudio.part.<name>), else the camelCase name in words. */
export function partLabel(lang: StudioLang, name: string): string {
  const id = `designStudio.part.${name}`;
  const label = messageText({ en, ko }, lang, id);
  if (label !== id) return label;
  const words = name.replace(/([A-Z])/g, " $1").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A choice's own name, the token it sets: "Button shape", "버튼 모서리". */
export function choiceLabel(lang: StudioLang, component: string, property: string): string {
  return `${partLabel(lang, component)} ${partLabel(lang, property).toLowerCase()}`;
}
