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
 * @fileoverview Sorts the datasets the trace sources offer for the sidebar's
 * "Add dataset" menu: regular datasets go in sections under their source's
 * label, and demo datasets (from any source) go behind the menu's single
 * "Demo traces" entry, which opens a picker.
 */

import { DatasetInfo, TraceSource } from './trace-source';

/** Label of the menu entry that opens the demo trace picker. */
export const DEMO_TRACES_LABEL = 'Demo traces';

/** One dataset offered in the "Add dataset" menu or the demo picker. */
export interface AddMenuItem {
  source: TraceSource;
  dataset: DatasetInfo;
  /** Already in the workspace, so shown disabled. */
  loaded: boolean;
}

/** A labeled section of the "Add dataset" menu. */
export interface AddMenuGroup {
  label: string;
  items: AddMenuItem[];
}

export interface AddMenu {
  /** Non-demo datasets, one section per source that has any. */
  groups: AddMenuGroup[];
  /** Demo datasets from every source, for the demo picker. */
  demos: AddMenuItem[];
}

/**
 * Builds the menu from each source's datasets, in source order. `loadedKeys`
 * holds the `<sourceId>:<datasetId>` keys already loaded. Empty sections are
 * omitted.
 */
export function buildAddMenu(
  available: ReadonlyArray<{ source: TraceSource; datasets: readonly DatasetInfo[] }>,
  loadedKeys: ReadonlySet<string>,
): AddMenu {
  const item = (source: TraceSource, dataset: DatasetInfo): AddMenuItem =>
    ({ source, dataset, loaded: loadedKeys.has(`${source.id}:${dataset.id}`) });
  const demos: AddMenuItem[] = [];
  const groups: AddMenuGroup[] = [];
  for (const { source, datasets } of available) {
    const others: AddMenuItem[] = [];
    for (const dataset of datasets) {
      (dataset.isDemo ? demos : others).push(item(source, dataset));
    }
    if (others.length > 0) groups.push({ label: source.label, items: others });
  }
  return { groups, demos };
}
