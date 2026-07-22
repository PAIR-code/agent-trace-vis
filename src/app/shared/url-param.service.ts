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
 * @fileoverview Shared service to handle URL parameter processing, API key extraction,
 * and dataset/trace selection query parameters for link sharing.
 */

import { Injectable } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

export interface DatasetItemLike {
  name: string;
  file: string;
  repoId?: string;
}

@Injectable({ providedIn: 'root' })
export class UrlParamService {
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

  /**
   * Helper to parse query parameters from ActivatedRoute snapshot or window.location.
   */
  getParam(paramNames: string[], route?: ActivatedRoute): string | undefined {
    if (route && route.snapshot && route.snapshot.queryParams) {
      for (const name of paramNames) {
        const val = route.snapshot.queryParams[name];
        if (val !== undefined && val !== null && val !== '') return String(val);
      }
    }

    try {
      const urlObj = new URL(window.location.href);
      for (const name of paramNames) {
        if (urlObj.searchParams.has(name)) return urlObj.searchParams.get(name)!;
      }
      if (urlObj.hash && urlObj.hash.includes('?')) {
        const hashQuery = urlObj.hash.substring(urlObj.hash.indexOf('?') + 1);
        const hashParams = new URLSearchParams(hashQuery);
        for (const name of paramNames) {
          if (hashParams.has(name)) return hashParams.get(name)!;
        }
      }
    } catch (e) {
      console.warn('Failed to parse URL params from location:', e);
    }
    return undefined;
  }

  /**
   * Updates query parameters in the current route URL.
   */
  updateQueryParams(queryParams: Record<string, string | null>, route?: ActivatedRoute): void {
    this.router.navigate([], {
      relativeTo: route,
      queryParams,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /**
   * Extracts dataset & example indices URL params for Agentic Traces.
   */
  getTraceUrlParams(route?: ActivatedRoute): { dataset?: string; indices?: string } {
    const dataset = this.getParam(['dataset', 'datasetId'], route);
    const indices = this.getParam(['indices', 'exampleIndices', 'examples', 'index'], route);
    return { dataset, indices };
  }

  /**
   * Checks dataset existence and parses integer example indices from URL params.
   * Logs warnings if requested dataset is not found or indices are invalid.
   */
  resolveInitialDatasetAndIndices<T extends DatasetItemLike>(
    loadedDatasets: T[],
    selectDatasetId?: string,
    route?: ActivatedRoute
  ): { targetId: string; pendingIndices: number[] | null } {
    const urlParams = this.getTraceUrlParams(route);
    let targetId = '';
    let pendingIndices: number[] | null = null;

    if (urlParams.dataset) {
      const rawDatasetParam = urlParams.dataset.trim();
      const normalizedParam = rawDatasetParam.toLowerCase();

      const dsMatch = loadedDatasets.find(
        d =>
          d.file === rawDatasetParam ||
          d.file.toLowerCase() === normalizedParam ||
          d.name === rawDatasetParam ||
          d.name.toLowerCase() === normalizedParam ||
          (d.repoId && (d.repoId === rawDatasetParam || d.repoId.toLowerCase() === normalizedParam))
      );

      if (dsMatch) {
        targetId = dsMatch.file;
      } else {
        console.warn(`[Agent Trace] Dataset "${urlParams.dataset}" requested in URL parameters was not found. Defaulting to initial dataset.`);
      }
    }

    if (!targetId) {
      targetId = selectDatasetId || (loadedDatasets.length > 0 ? loadedDatasets[0].file : '');
    }

    if (urlParams.indices !== undefined) {
      const parts = urlParams.indices.split(',').map(s => s.trim()).filter(s => s !== '');
      const parsed = parts.map(p => Number(p)).filter(n => !isNaN(n) && Number.isInteger(n));
      if (parsed.length > 0) {
        pendingIndices = parsed;
      } else {
        console.warn(`[Agent Trace] Invalid indices parameter in URL: "${urlParams.indices}".`);
      }
    }

    return { targetId, pendingIndices };
  }

  /**
   * Filters target indices against traces list length and logs warnings for out-of-range indices.
   * Returns valid selected trace IDs (or defaults to first trace ID if none are valid).
   */
  validateAndSelectTraceIds(tracesList: { id: string }[], targetIndices?: number[] | null): string[] {
    if (tracesList.length === 0) return [];

    let selectedIds: string[] = [];
    if (targetIndices && targetIndices.length > 0) {
      const outOfRange = targetIndices.filter(idx => idx < 0 || idx >= tracesList.length);
      if (outOfRange.length > 0) {
        console.warn(
          `[Agent Trace] Requested trace index/indices [${outOfRange.join(
            ', '
          )}] are out of range for dataset (total traces: ${tracesList.length}, valid range: 0 to ${
            tracesList.length - 1
          }).`
        );
      }

      const validIds = targetIndices
        .filter(idx => idx >= 0 && idx < tracesList.length)
        .map(idx => tracesList[idx].id);
      if (validIds.length > 0) {
        selectedIds = validIds;
      }
    }

    if (selectedIds.length === 0) {
      selectedIds = [tracesList[0].id];
    }

    return selectedIds;
  }
}
