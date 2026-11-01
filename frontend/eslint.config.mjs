/*
  Chosen per defect, as .golangci.yml and the sidecar's Ruff set are. Each rule names
  what it stops from coming back, and a preset is absent on purpose: a broad one over
  this tree reported 1,821 things, of which 1,269 were the code's own idioms.

  Left out after being measured:

    curly: all        `if (x) return` on one line is the idiom here, 1,112 to 430.
    eqeqeq: always    every loose comparison in the tree is `== null`.
    no-unstable-nested-components
                      all 13 reports were render props, which are not components.
    react-hooks/refs, set-state-in-effect, and the rest of the plugin's compiler set
                      they ask for what the React Compiler needs, and this project
                      does not run it.
*/
import reactHooks from "eslint-plugin-react-hooks"
import tseslint from "typescript-eslint"

export default [
  { ignores: ["dist/", "vendor/", "wailsjs/", "src/components/icons.tsx"] },
  {
    /*
      25 `eslint-disable` comments existed before there was an ESLint to read them.
      One that suppresses nothing is a claim about a rule that no longer holds.
    */
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["src/**/*.{ts,tsx}", "scripts/**/*.ts"],
    languageOptions: { parser: tseslint.parser },
    rules: {
      // Only the form Prettier produces from an overlong line: a body on the next line
      // with nothing to show it belongs to the `if`.
      curly: ["error", "multi-line"],
      // `== null` is how this tree says null or undefined. Anything else loose coerces.
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      "react-hooks": reactHooks,
    },
    rules: {
      // A hook called conditionally shifts the state of every hook after it, and shows
      // up as a value in the wrong field rather than as an error.
      "react-hooks/rules-of-hooks": "error",

      // A closure over a value from an earlier render reads as a stale number on screen.
      // Where one is meant, the directive says so at that line.
      "react-hooks/exhaustive-deps": "error",

      // A rejection nobody handles reaches no one: the reader sees nothing happen. The
      // convention here is `void` for a promise that handles its own failure.
      "@typescript-eslint/no-floating-promises": "error",

      // The same, through a prop. A handler typed to return void can be handed something
      // async, and whoever calls it cannot know there is a rejection to catch.
      "@typescript-eslint/no-misused-promises": "error",

      // A cast the compiler does not need stops checking the moment the type changes.
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
    },
  },
]
