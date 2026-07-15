/**
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
 * @fileoverview Shared service to handle secure extraction and cleanup of API keys from the URL.
 */

import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class UrlParamService {
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
        localStorage.setItem('reasoning_vis_api_key', key);

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
}
