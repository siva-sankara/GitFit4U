import js from "@eslint/js";
import globals from "globals";
import babelParser from "@babel/eslint-parser";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";

// Keep correctness checks independent from formatting and legacy typing cleanup.
export default defineConfig([
  { ignores: ["dist/**", "node_modules/**", "coverage/**", ".openai/**"] },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "no-unused-vars": "off",
      "no-promise-executor-return": "error",
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
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
    // The build's TS 7 compiler checks identifiers, including type-only names.
    rules: { "no-undef": "off" },
  },
  {
    files: ["**/*.tsx"],
    languageOptions: {
      parserOptions: {
        babelOptions: {
          plugins: [["@babel/plugin-syntax-typescript", { isTSX: true }]],
        },
      },
    },
  },
  {
    files: ["*.config.{js,mjs,ts}", "scripts/**/*.{js,mjs,ts}"],
    languageOptions: { globals: globals.node },
  },
]);
