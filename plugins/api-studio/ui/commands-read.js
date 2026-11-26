// Read the person's prepared requests and responses without sending them.
import { sendContext } from "./actions.js";
import { GENERATORS, hideSecrets } from "./codegen.js";
import { commandSecrets, requestData, responseData } from "./command-data.js";
import { hideText } from "./secret-names.js";
import { markSecrets, prepare } from "./send.js";

/** @param {import("./commands.js").Register} on @param {import("./commands.js").CommandContext} ctx */
export function registerReads(on, { S, saved, findTab }) {
  on("request", ({ name }) => {
    const tab = saved(name, true);
    return { request: requestData(S, tab) };
  });
  on("tab", ({ name }) => {
    const tab = findTab(name);
    return {
      request: requestData(S, tab),
      response: responseData(S, tab),
      unsaved: S.app.dirty(tab),
    };
  });
  on("codegen", ({ request, lang }) => {
    const generator = Object.hasOwn(GENERATORS, lang) ? GENERATORS[lang] : undefined;
    if (!generator) throw new Error("Choose an API Studio code generator.");
    const tab = saved(request, true);
    const { prep } = prepare(tab.req, sendContext(S, tab));
    const values = [...new Set([...commandSecrets(S, tab), ...(prep.secrets ?? [])])].sort(
      (a, b) => b.length - a.length,
    );
    const masked = hideSecrets(markSecrets({ ...prep, secrets: values }));
    const code = hideText(generator.make(masked), values);
    if (code.length > 32_768) throw new Error("The generated code is too large to return.");
    return { lang, code };
  });
}
