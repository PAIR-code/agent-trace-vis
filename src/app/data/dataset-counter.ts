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

/** @fileoverview The selected / total counter on each sidebar dataset header. */

export interface DatasetCounter {
  /** The dataset's trace list is still loading: show a spinner instead of numbers. */
  loading: boolean;
  /** Selected examples, shown bold before the total; null when none are selected. */
  selected: number | null;
  /** The total part: "36", or while loading with nothing selected "20 / 36" or "20+". */
  total: string;
  /** Hover text spelling the numbers out. */
  title: string;
}

/**
 * Builds the dataset header counter, e.g. "4/36" with the 4 in bold. With
 * nothing selected it shows just the total (the loaded-so-far count while pages
 * are still loading). With a selection it uses the known total, or the loaded
 * count plus "+" when the total is unknown. While the trace list is still
 * loading there are no numbers yet, so the header shows a spinner.
 */
export function datasetCounter(
  selected: number, loaded: number, totalCount: number | null, hasMore: boolean, loading = false,
): DatasetCounter {
  if (loading) return { loading: true, selected: null, total: '', title: 'Loading traces…' };
  const knownTotal = totalCount !== null;
  const plural = (n: number) => `${n} ${n === 1 ? 'trace' : 'traces'}`;
  const totalText = knownTotal ? `${totalCount}` : hasMore ? `${loaded}+` : `${loaded}`;
  const totalTitle = knownTotal ? plural(totalCount) : hasMore ? `${plural(loaded)} loaded so far` : plural(loaded);

  if (selected > 0) {
    return { loading: false, selected, total: totalText, title: `${selected} selected of ${totalTitle}` };
  }
  if (knownTotal && loaded < totalCount) {
    return { loading: false, selected: null, total: `${loaded} / ${totalCount}`, title: `${loaded} of ${plural(totalCount)} loaded` };
  }
  return { loading: false, selected: null, total: totalText, title: totalTitle };
}
