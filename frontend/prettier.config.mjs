/*
  The options are the code as it was already written, measured rather than chosen:
  across 12,000 statements 98.7% had no semicolon, and every multi-line object and
  array had a trailing comma while no argument list did. What had never been decided
  was a width, and 88 is the one Ruff holds the sidecar to, so the two languages in
  this repository wrap at the same column.

  The Tailwind plugin is here because a class list is the longest thing on most lines
  of a component, and nothing else put its classes in any order: the same five
  utilities read differently from one file to the next.
*/
export default {
  printWidth: 88,
  semi: false,
  trailingComma: "es5",
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./src/index.css",
  tailwindFunctions: ["cn"],
}
