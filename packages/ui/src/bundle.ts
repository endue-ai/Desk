// The browser bundle (dist/ui.js, dist/ui.iife.js): the tokens and the elements, defined on import.
import { defineElements } from "./elements";

export * from "./elements";
export * from "./index";

if (typeof customElements !== "undefined") defineElements();
