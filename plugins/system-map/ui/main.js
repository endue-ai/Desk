import "@endue-ai/ui";
import { defineUiPlugin } from "@endue-ai/plugin-sdk";
import { collect } from "./collect.js";
import { mountPage } from "./page.js";

defineUiPlugin({
  mount(ctx) {
    const page = mountPage(document, {
      supported: /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform),
      t: (key, params) => ctx.messages.t(key, params),
      collect: (signal, askAgain) => collect(ctx, signal, askAgain),
    });
    const words = () => {
      document.documentElement.lang = ctx.messages.language();
      page.draw();
    };
    words();
    const off = ctx.messages.onChange(words);
    const dispose = () => {
      off();
      page.dispose();
    };
    window.addEventListener("pagehide", dispose, { once: true });
  },
});
