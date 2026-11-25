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
 * @fileoverview Where traces come from. A `TraceSource` offers datasets, lists
 * a dataset's examples (paged), and loads the trace records of chosen examples.
 * Sources are registered with the `TRACE_SOURCES` multi-provider; the
 * `WorkspaceService` combines them into the examples sidebar.
 *
 * To add a source (e.g. a server of your own), implement `TraceSource` and
 * provide it:
 *
 *     providers: [{provide: TRACE_SOURCES, useClass: MySource, multi: true}]
 */

import { InjectionToken } from '@angular/core';
import { TraceRecord } from '../agentic-traces/trace';

/** A dataset a source can offer. */
export interface DatasetInfo {
  /** Unique within its source; part of shareable URLs. */
  id: string;
  name: string;
  /** Loaded automatically when the app opens without datasets in its URL. */
  isDefault?: boolean;
  /**
   * A demo dataset: offered by the "Add dataset" menu's "Demo traces" picker
   * rather than loaded automatically. A URL that names it still loads it.
   */
  isDemo?: boolean;
}

/** One example (trace) in a dataset, as listed in the sidebar. */
export interface ExampleSummary {
  /** Position in the dataset; used to load and to link to the example. */
  index: number;
  title: string;
  /** The trace's own id, shown under the title when it differs. */
  id?: string;
  /** ISO timestamp of the trace's start. */
  date?: string;
  stepCount?: number;
  outcome?: { success?: boolean; reward?: number };
  /** The trace's simple metadata values (see scalarMetadata), for grouping and coloring. */
  metadata?: Record<string, string | number | boolean>;
  /** Trace id of the trace that launched this one, for a subagent. */
  parentId?: string;
}

export interface ExamplesPage {
  examples: ExampleSummary[];
  /** Null when the source can't count cheaply. */
  totalCount: number | null;
  hasMore: boolean;
}

/** An extra item in the sidebar's "Add dataset" menu (e.g. a file picker). */
export interface SourceAction {
  label: string;
  /** Resolves to the dataset to add, or null if the user cancelled. */
  run(): Promise<DatasetInfo | null>;
}

export interface TraceSource {
  /** Short stable id, e.g. "bundled"; used in URLs. */
  readonly id: string;
  /** Short label shown on the dataset's sidebar section, e.g. "SAMPLE". */
  readonly label: string;
  /** Datasets to offer in the "Add dataset" menu (may be empty). */
  listDatasets(): Promise<DatasetInfo[]>;
  listExamples(datasetId: string, offset: number, limit: number): Promise<ExamplesPage>;
  /** Trace records for `indices`, in the same order. */
  loadTraces(datasetId: string, indices: number[]): Promise<TraceRecord[]>;
  /** Display name for a dataset that isn't listed (e.g. restored from a URL). */
  datasetName?(datasetId: string): string;
  /** Canonicalizes a dataset id (e.g. stripping trailing slashes or normalizing delimiters). */
  normalizeDatasetId?(datasetId: string): string;
  /** Called when the user removes the dataset from the workspace. */
  onRemove?(datasetId: string): void;
  /** Extra "Add dataset" menu items. */
  readonly actions?: SourceAction[];
}

export const TRACE_SOURCES = new InjectionToken<readonly TraceSource[]>('TRACE_SOURCES');
