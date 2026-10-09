/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// @ts-check
/**
 * ESLint config enforcing promise handling and banning computed writes to DOM
 * content sinks.
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
      // Every Promise must be awaited, handled, or explicitly marked with `void`.
      '@typescript-eslint/no-floating-promises': 'error',
      // Ban computed writes to DOM text/HTML sinks.
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "AssignmentExpression[left.property.name=/^(textContent|innerText|innerHTML|outerHTML)$/]:not([right.type='Literal'])",
          message:
            'Computed writes to DOM content sinks are banned. Use DOM APIs (createElement/insertRule/textNode) instead.',
        },
      ],
    },
  },
);
