/**
 * Tightens built-in lib typings (e.g. `JSON.parse` returns `unknown` instead
 * of `any`) to match the TypeScript lib used in google3, so type errors that
 * would surface on import are caught locally.
 */
import '@total-typescript/ts-reset';
