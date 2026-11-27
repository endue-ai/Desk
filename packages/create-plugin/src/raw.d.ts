// Template assets are imported as text and bundled into the CLI by Vite.
declare module "*?raw" {
  const text: string;
  export default text;
}
