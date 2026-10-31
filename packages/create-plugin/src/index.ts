export const NAME = "@endue-ai/create-plugin";

export { type Io, main, USAGE } from "./cli";
export { checkId, defaultId, defaultName } from "./names";
export { type PluginOptions, renderPlugin, type TemplateKind } from "./template";
export { FolderError, writePlugin } from "./write";
