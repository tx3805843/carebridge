/** Shared ESLint flat config preset for CareBridge workspaces. */
module.exports = {
  extends: ["next/core-web-vitals", "turbo", "prettier"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": ["warn", { allow: ["warn", "error"] }],
  },
};
