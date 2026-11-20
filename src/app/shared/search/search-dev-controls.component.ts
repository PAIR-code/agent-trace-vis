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
 * @fileoverview Dev-only AI search controls shown next to the AI toggle: a
 * model picker, a skip-cache toggle, and a readout of the last search's model,
 * time, and cache use. Renders nothing unless the search service offers dev
 * models (see `SearchService.devModels`).
 */

import {ChangeDetectionStrategy, Component, inject} from '@angular/core';

import {SearchRunInfo, SearchService} from './search.service';

/** Formats a search run for the readout, e.g. "gemini-x · 2.4 s · 2 calls". */
export function formatSearchRun(run: SearchRunInfo): string {
  const time = run.elapsedMs < 1000
    ? `${Math.round(run.elapsedMs)} ms`
    : `${(run.elapsedMs / 1000).toFixed(1)} s`;
  const parts: string[] = [];
  if (run.modelCalls > 0) {
    parts.push(`${run.modelCalls} ${run.modelCalls === 1 ? 'call' : 'calls'}`);
  }
  if (run.cacheHits > 0) {
    parts.push(run.modelCalls > 0 ? `${run.cacheHits} cached` : 'cached');
  }
  return [run.model, time, ...parts].join(' · ');
}

/** Model picker, skip-cache toggle, and last-search readout for AI search. */
@Component({
  selector: 'app-search-dev-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (search.devModels().length > 0) {
      <div class="dev-controls" title="Dev only: compare AI search models">
        <select #modelSelect class="dev-model" aria-label="AI search model"
                (change)="search.model.set(modelSelect.value)">
          @for (model of search.devModels(); track model) {
            <option [value]="model" [selected]="model === search.model()">{{ model }}</option>
          }
        </select>
        <label class="dev-skip" title="Ignore cached results and always call the model">
          <input #skipBox type="checkbox" [checked]="search.skipCache()"
                 (change)="search.skipCache.set(skipBox.checked)">
          skip cache
        </label>
        @if (search.lastRun(); as run) {
          <span class="dev-readout" [class.cached]="run.modelCalls === 0">{{ format(run) }}</span>
        }
      </div>
    }
  `,
  styles: [`
    .dev-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      font-size: 0.7rem;
      color: rgba(255,255,255,0.8);
    }

    .dev-model {
      background: rgba(0,0,0,0.25);
      color: #fff;
      border: 1px dashed rgba(251,191,36,0.6);
      border-radius: 4px;
      font-size: 0.7rem;
      padding: 1px 4px;
      max-width: 170px;
    }

    .dev-model option {
      color: #000;
    }

    .dev-skip {
      display: flex;
      align-items: center;
      gap: 3px;
      white-space: nowrap;
      cursor: pointer;
    }

    .dev-readout {
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
      color: #fde68a;
    }

    .dev-readout.cached {
      color: rgba(255,255,255,0.55);
    }
  `],
})
export class SearchDevControlsComponent {
  protected readonly search = inject(SearchService);
  protected readonly format = formatSearchRun;
}
