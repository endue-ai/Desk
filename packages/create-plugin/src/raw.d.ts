// The theme test the theme template carries (examples/plugin-hello-theme's), imported as text; Vite
// bundles it at build time.
declare module "*.test.ts?raw" {
  const text: string;
  export default text;
}
