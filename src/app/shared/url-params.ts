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

/**
 * @fileoverview Pure helpers for reading and normalizing query parameters across
 * both pre-hash (`?a=1`) and hash-routed (`#/?a=1`) URLs.
 */

function appendEntries(
  target: Map<string, string[]>,
  params: URLSearchParams,
): void {
  params.forEach((value, key) => {
    const existing = target.get(key);
    if (existing) {
      existing.push(value);
    } else {
      target.set(key, [value]);
    }
  });
}

/**
 * Merges query parameters from `window.location.search` (pre-hash), hash query
 * params (`#/...?...`), and optional Angular `routeParams`.
 *
 * Pre-hash values come first, followed by hash values (with exact duplicate
 * values skipped), so scalar lookups (last value) prefer hash params while
 * multi-value params (such as repeated `ds`) collect entries from both places.
 */
export function parseLocationQueryParams(
  href: string,
  routeParams?: Readonly<Record<string, unknown>>,
): Map<string, string[]> {
  const searchMap = new Map<string, string[]>();
  const hashMap = new Map<string, string[]>();

  try {
    const url = new URL(href);
    appendEntries(searchMap, url.searchParams);
    const qIdx = url.hash.indexOf('?');
    if (qIdx >= 0) {
      appendEntries(hashMap, new URLSearchParams(url.hash.slice(qIdx + 1)));
    }
  } catch {
    // Ignore malformed URLs and fall back to routeParams if provided.
  }

  if (routeParams) {
    for (const [key, raw] of Object.entries(routeParams)) {
      if (raw === undefined || raw === null || hashMap.has(key)) continue;
      const vals = Array.isArray(raw) ? raw.map(String) : [String(raw)];
      if (vals.length > 0) {
        hashMap.set(key, vals);
      }
    }
  }

  const merged = new Map<string, string[]>();
  for (const [key, vals] of searchMap) {
    merged.set(key, [...vals]);
  }
  for (const [key, vals] of hashMap) {
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, [...vals]);
    } else {
      for (const v of vals) {
        if (!existing.includes(v)) {
          existing.push(v);
        }
      }
    }
  }
  return merged;
}

/** Returns the last non-empty value for the first matching parameter name. */
export function getParamFromMap(
  params: ReadonlyMap<string, readonly string[]>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const vals = params.get(name);
    if (!vals || vals.length === 0) continue;
    for (let i = vals.length - 1; i >= 0; i--) {
      if (vals[i] !== '') return vals[i];
    }
  }
  return undefined;
}

/** Returns all non-empty values across the given parameter names, in order. */
export function getParamValuesFromMap(
  params: ReadonlyMap<string, readonly string[]>,
  names: readonly string[],
): string[] {
  const out: string[] = [];
  for (const name of names) {
    const vals = params.get(name);
    if (!vals) continue;
    for (const v of vals) {
      if (v !== '') out.push(v);
    }
  }
  return out;
}

/**
 * Deletes `keys` from the pre-hash `search` portion of `href`. Returns the
 * updated URL string when any key was removed, or `null` if unchanged.
 */
export function stripSearchParams(
  href: string,
  keys: Iterable<string>,
): string | null {
  try {
    const url = new URL(href);
    let changed = false;
    for (const key of keys) {
      if (url.searchParams.has(key)) {
        url.searchParams.delete(key);
        changed = true;
      }
    }
    return changed ? url.toString() : null;
  } catch {
    return null;
  }
}
