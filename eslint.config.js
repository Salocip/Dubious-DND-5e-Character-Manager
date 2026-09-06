import js from "@eslint/js";
import globals from "globals";
import htmlPlugin from "eslint-plugin-html";
import noUnsanitized from "eslint-plugin-no-unsanitized";

const noUnsanitizedRules = noUnsanitized.configs.recommended?.rules;
if (!noUnsanitizedRules) {
  throw new Error("eslint-plugin-no-unsanitized: expected configs.recommended.rules to exist");
}

const projectGlobals = {
  ...globals.browser,
  Fuse: "readonly",
  Sortable: "readonly",
  Alpine: "readonly",
};

export default [
  { ignores: ["node_modules/**", "playwright-report/**", "test-results/**"] },

  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      // page.evaluate bodies run in the browser context, so browser globals
      // (document, Alpine, window) are legitimate inside test files.
      globals: { ...globals.node, ...globals.browser, Alpine: "readonly" },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  {
    files: ["scripts/**/*.{js,mjs}", "*.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },

  {
    files: ["**/*.html"],
    plugins: { html: htmlPlugin, "no-unsanitized": noUnsanitized },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "script",
      globals: projectGlobals,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...noUnsanitizedRules,
      "no-implicit-globals": "off", // app's inline script intentionally uses top-level (global) functions
      "no-redeclare": "error",
    },
  },
];
