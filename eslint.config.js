// @ts-check
/**
 * ESLint config approximating the Google-internal (tsetse) conformance checks
 * this code must pass when imported into google3, so violations fail locally
 * and in CI rather than during import.
 */
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'out-tsc/**', '.angular/**', 'node_modules/**'],
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // tsetse must-use-promises
      '@typescript-eslint/no-floating-promises': 'error',
      // Approximates tsetse ban-style-content-assignments / DOM sink checks.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.property.name=/^(textContent|innerText|innerHTML|outerHTML)$/]:not([right.type='Literal'])",
          message:
            'Computed writes to DOM content sinks are banned in google3 (go/ts-dom-sink). Use DOM APIs (createElement/insertRule/textNode) instead.',
        },
      ],
    },
  },
);
