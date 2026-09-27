import js from "@eslint/js";
import globals from "globals";
import babelParser from "@babel/eslint-parser";
import { defineConfig } from "eslint/config";

// Correctness gate; formatting remains the responsibility of Prettier.
// Babel parses TS syntax without the unsupported typescript-eslint/TS 7 peer pair.
// The separate build gate continues to enforce TypeScript semantic correctness.
export default defineConfig([
  { ignores: ["dist/**", "node_modules/**", "coverage/**", ".openai/**"] },
  {
    files: ["**/*.{js,mjs,cjs,ts}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
    rules: {
      "no-unused-vars": "off",
      "no-promise-executor-return": "error",
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          plugins: [["@babel/plugin-syntax-typescript", { isTSX: false }]],
        },
      },
    },
    rules: { "no-undef": "off" },
  },
]);
