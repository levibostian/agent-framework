// Markdown imported with `with { type: "text" }` resolves to its contents as a string.
declare module "*.md" {
  const text: string;
  export default text;
}
