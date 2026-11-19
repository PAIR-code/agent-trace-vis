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
 * @fileoverview Shared service to handle URL parameter processing, API key extraction,
 * and unified query parameter reads/updates across pre-hash and hash routes.
 */

import {Injectable, InjectionToken} from '@angular/core';
import {ActivatedRoute, Router} from '@angular/router';

import {
  getParamFromMap,
  getParamValuesFromMap,
  parseLocationQueryParams,
  stripSearchParams,
} from './url-params';

/** Extra query parameter keys owned by an integration (migrated from pre-hash search). */
export const EXTRA_MANAGED_URL_PARAMS = new InjectionToken<readonly string[]>(
  'EXTRA_MANAGED_URL_PARAMS',
);

@Injectable({ providedIn: 'root' })
export class UrlParamService {
  private lastSerializedQuery = '';

  constructor(private router: Router) {}

  /**
   * Extracts Gemini API key from URL parameters, saves it to localStorage, and sanitizes the URL.
   */
  processUrlParameters(): void {
    try {
      const url = new URL(window.location.href);
      let key = url.searchParams.get('key') || url.searchParams.get('apiKey');

      if (!key && url.hash.includes('?')) {
        const hashQuery = url.hash.substring(url.hash.indexOf('?') + 1);
        const hashParams = new URLSearchParams(hashQuery);
        key = hashParams.get('key') || hashParams.get('apiKey');
      }

      if (key) {
        window.localStorage.setItem('reasoning_vis_api_key', key);

        // Clean up key parameters from main search params
        url.searchParams.delete('key');
        url.searchParams.delete('apiKey');

        // Clean up key parameters from hash-based search params
        if (url.hash.includes('?')) {
          const hashBase = url.hash.substring(0, url.hash.indexOf('?'));
          const hashQuery = url.hash.substring(url.hash.indexOf('?') + 1);
          const hashParams = new URLSearchParams(hashQuery);
          hashParams.delete('key');
          hashParams.delete('apiKey');

          const remainingParams = hashParams.toString();
          url.hash = remainingParams ? `${hashBase}?${remainingParams}` : hashBase;
        }

        window.history.replaceState({}, '', url.toString());
      }
    } catch (e) {
      console.error('Failed to parse API key from URL:', e);
    }
  }

  /** Returns all query parameters merged from `window.location.search`, hash, and route. */
  readAllQueryParams(route?: ActivatedRoute): Map<string, string[]> {
    const href = typeof window !== 'undefined' ? window.location.href : '';
    return parseLocationQueryParams(href, route?.snapshot?.queryParams);
  }

  /**
   * Helper to parse query parameters from ActivatedRoute snapshot or window.location.
   */
  getParam(paramNames: string[], route?: ActivatedRoute): string | undefined {
    return getParamFromMap(this.readAllQueryParams(route), paramNames);
  }

  /** Returns all values for `paramNames` across search and hash query params. */
  getParamValues(paramNames: string[], route?: ActivatedRoute): string[] {
    return getParamValuesFromMap(this.readAllQueryParams(route), paramNames);
  }

  /**
   * Removes `keys` from pre-hash `window.location.search` via `history.replaceState`
   * after migrating them into the Angular hash router.
   */
  clearSearchParams(keys: Iterable<string>): void {
    if (typeof window === 'undefined') return;
    try {
      const nextUrl = stripSearchParams(window.location.href, keys);
      if (nextUrl !== null) {
        window.history.replaceState({}, '', nextUrl);
      }
    } catch (e) {
      console.warn('Failed to clear migrated search params:', e);
    }
  }

  /**
   * Updates query parameters in the current route URL, skipping redundant navigations
   * when the serialized parameter payload is unchanged.
   */
  updateQueryParams(
    queryParams: Record<string, string | string[] | null>,
    route?: ActivatedRoute,
  ): void {
    const normalized: Record<string, string | string[] | null> = {};
    for (const [k, v] of Object.entries(queryParams)) {
      if (Array.isArray(v)) {
        normalized[k] = v.length > 0 ? v : null;
      } else {
        normalized[k] = v;
      }
    }
    const signature = JSON.stringify(
      Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (signature === this.lastSerializedQuery) return;
    this.lastSerializedQuery = signature;

    void this.router.navigate([], {
      relativeTo: route,
      queryParams: normalized,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
