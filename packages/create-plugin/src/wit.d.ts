// The WIT files the connector template carries, imported as text; Vite bundles them at build time.
declare module "*.wit?raw" {
  const text: string;
  export default text;
}
