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
 * @fileoverview The workspace: the datasets loaded into the examples sidebar
 * (from any registered `TraceSource`), their paged example lists, which
 * examples are selected, and the parsed traces of the selected examples.
 *
 * Trace entry ids are namespaced per dataset and example index, so the same
 * trace in two datasets doesn't collide. The workspace round-trips through the
 * URL as repeated `ds=<source>:<dataset>[:<indices>]` parameters.
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { groupOf, linkGroups } from '../agentic-traces/agent-groups';
import { TraceEntry } from '../agentic-traces/layout-types';
import { hashString } from '../agentic-traces/layout-utils';
import { TraceRecord } from '../agentic-traces/trace';
import { TraceLoaderService } from '../agentic-traces/trace-loader.service';
import { TELEMETRY_TRACKER } from '../shared/telemetry.service';
import { DatasetRef, coalesceDatasetRefs, formatDatasetRef } from './dataset-refs';
import { DatasetInfo, ExampleSummary, TRACE_SOURCES, TraceSource } from './trace-source';

/** Examples fetched per page. */
const PAGE_SIZE = 100;
/** Datasets this small have all their traces fetched up front, so subagents and teams can be grouped. */
const PREFETCH_LIMIT = 60;
const RENAMES_KEY = 'agent_trace_vis_renames';

export interface LoadedDataset {
  /** `<sourceId>:<datasetId>`. */
  key: string;
  sourceId: string;
  datasetId: string;
  name: string;
  examples: ExampleSummary[];
  totalCount: number | null;
  hasMore: boolean;
  loadingExamples: boolean;
  loadingMore: boolean;
  /** Trace fetches in flight for this dataset (its header shows a spinner meanwhile). */
  fetchingTraces: number;
  /** Example indices selected, in selection order. */
  selected: number[];
  error?: string;
}

@Injectable({ providedIn: 'root' })
export class WorkspaceService {
  readonly sources: readonly TraceSource[] = inject(TRACE_SOURCES, { optional: true }) ?? [];
  private readonly traceLoader = inject(TraceLoaderService);
  private readonly telemetry = inject(TELEMETRY_TRACKER, { optional: true });

  readonly datasets = signal<LoadedDataset[]>([]);
  /** Parsed traces of the selected examples, in dataset then selection order. */
  readonly selectedEntries = signal<TraceEntry[]>([]);
  /** The trace the user just picked; the timeline makes it the active row. */
  readonly focusEntryId = signal<string | null>(null);
  /** Shared sidebar UI state synced with URL config parameters. */
  readonly sidebarCollapsed = signal(false);
  readonly sidebarFilter = signal('');
  /** Number of trace fetches in flight. */
  private readonly pendingFetches = signal(0);
  readonly isFetching = computed(() => this.pendingFetches() > 0);
  readonly error = signal('');

  readonly totalSelected = computed(() => this.datasets().reduce((n, d) => n + d.selected.length, 0));
  /** The `ds` URL parameter values describing the workspace. */
  readonly urlRefs = computed(() => this.datasets().map(d =>
    formatDatasetRef({ sourceId: d.sourceId, datasetId: d.datasetId, indices: d.selected })));

  /** `<datasetKey>#<index>` -> parsed entry (selected or prefetched). */
  private readonly entries = new Map<string, TraceEntry>();
  /** Entry id -> where it came from. */
  private readonly entryOrigin = new Map<string, { key: string; index: number }>();
  /** In-flight `addDataset` operations keyed by `<sourceId>:<datasetId>` to prevent concurrent races. */
  private readonly inflightAdds = new Map<string, { promise: Promise<void>; pendingSelect: number[] }>();
  private renames: Record<string, string> = loadRenames();

  source(sourceId: string): TraceSource | undefined {
    return this.sources.find(s => s.id === sourceId);
  }

  normalizeDatasetId(sourceId: string, datasetId: string): string {
    return this.source(sourceId)?.normalizeDatasetId?.(datasetId) ?? datasetId;
  }

  dataset(key: string): LoadedDataset | undefined {
    return this.datasets().find(d => d.key === key);
  }

  /** Where an entry came from (its dataset key and example index). */
  originOf(entryId: string): { key: string; index: number } | undefined {
    return this.entryOrigin.get(entryId);
  }

  /** Datasets each source offers, for the "Add dataset" menu. */
  async availableDatasets(): Promise<Array<{ source: TraceSource; datasets: DatasetInfo[] }>> {
    const lists = await Promise.all(this.sources.map(async source => ({
      source,
      datasets: await source.listDatasets().catch(err => {
        console.warn(`Failed to list datasets of source "${source.id}"`, err);
        return [] as DatasetInfo[];
      }),
    })));
    return lists.filter(l => l.datasets.length > 0);
  }

  /**
   * Restores the workspace from URL refs, or loads every default dataset when no
   * explicit URL refs are present. Demo datasets are never loaded here unless a
   * URL ref names them; the "Add dataset" menu's demo picker offers them. If nothing
   * ends up selected, selects the first example of the first dataset.
   */
  async init(refs: DatasetRef[]): Promise<void> {
    const coalesced = coalesceDatasetRefs(
      refs.map(r => ({
        ...r,
        datasetId: this.normalizeDatasetId(r.sourceId, r.datasetId),
      })),
    );
    if (coalesced.length > 0) {
      await Promise.all(
        coalesced.map(ref =>
          this.addDataset(ref.sourceId, { id: ref.datasetId, name: '' }, ref.indices)),
      );
    } else {
      const available = await this.availableDatasets();
      await Promise.all(
        available.flatMap(({ source, datasets }) =>
          datasets.filter(d => d.isDefault && !d.isDemo).map(ds => this.addDataset(source.id, ds))),
      );
    }
    if (this.totalSelected() === 0) {
      const first = this.datasets().find(d => d.examples.length > 0);
      if (first) await this.setSelected(first.key, [first.examples[0].index], first.examples[0].index);
    }
  }

  /**
   * Adds a dataset (or, if it's already loaded or loading, merges `select` into
   * its selection) and loads its first page of examples.
   */
  async addDataset(sourceId: string, info: DatasetInfo, select: number[] = []): Promise<void> {
    const source = this.source(sourceId);
    if (!source) {
      console.warn(`[Agent Trace] Unknown trace source "${sourceId}" for dataset "${info.id}".`);
      return;
    }
    const datasetId = source.normalizeDatasetId?.(info.id) ?? info.id;
    const key = `${sourceId}:${datasetId}`;

    const inflight = this.inflightAdds.get(key);
    if (inflight) {
      inflight.pendingSelect.push(...select);
      await inflight.promise;
      return;
    }

    const existing = this.dataset(key);
    if (existing) {
      if (select.length) await this.setSelected(key, [...existing.selected, ...select], select[select.length - 1]);
      return;
    }

    const entry = { promise: Promise.resolve(), pendingSelect: [...select] };
    entry.promise = (async () => {
      this.datasets.update(list => [...list, {
        key, sourceId, datasetId,
        name: info.name || source.datasetName?.(datasetId) || datasetId,
        examples: [], totalCount: null, hasMore: false,
        loadingExamples: true, loadingMore: false, fetchingTraces: 0, selected: [],
      }]);
      try {
        const page = await source.listExamples(datasetId, 0, PAGE_SIZE);
        this.patch(key, { examples: page.examples, totalCount: page.totalCount, hasMore: page.hasMore, loadingExamples: false });
        this.telemetry?.trackEvent('dataset_added', {
          source_id: sourceId,
          total_count: page.totalCount ?? page.examples.length,
          has_initial_selection: select.length > 0,
        });
        if (page.totalCount !== null && page.totalCount <= PREFETCH_LIMIT && page.totalCount > 0) {
          await this.fetch(key, page.examples.map(e => e.index));
        }
      } catch (err) {
        this.telemetry?.trackEvent('dataset_error', { source_id: sourceId });
        this.patch(key, { loadingExamples: false, error: errorMessage(err) });
        return;
      }
      const mergedSelect = [...new Set(entry.pendingSelect)];
      if (mergedSelect.length) {
        await this.setSelected(key, mergedSelect, mergedSelect[mergedSelect.length - 1]);
      }
    })().finally(() => {
      this.inflightAdds.delete(key);
    });

    this.inflightAdds.set(key, entry);
    await entry.promise;
  }

  async loadMore(key: string): Promise<void> {
    const ds = this.dataset(key);
    const source = ds && this.source(ds.sourceId);
    if (!ds || !source || ds.loadingMore || !ds.hasMore) return;
    this.patch(key, { loadingMore: true });
    try {
      const page = await source.listExamples(ds.datasetId, ds.examples.length, PAGE_SIZE);
      const current = this.dataset(key);
      if (!current) return;
      this.patch(key, {
        examples: [...current.examples, ...page.examples],
        totalCount: page.totalCount, hasMore: page.hasMore, loadingMore: false,
      });
    } catch (err) {
      this.patch(key, { loadingMore: false, error: errorMessage(err) });
    }
  }

  removeDataset(key: string): void {
    const ds = this.dataset(key);
    if (!ds) return;
    this.telemetry?.trackEvent('dataset_removed', { source_id: ds.sourceId });
    this.source(ds.sourceId)?.onRemove?.(ds.datasetId);
    for (const [entryKey, entry] of this.entries) {
      if (entryKey.startsWith(`${key}#`)) {
        this.entries.delete(entryKey);
        this.entryOrigin.delete(entry.id);
      }
    }
    this.datasets.update(list => list.filter(d => d.key !== key));
    this.recompute();
  }

  /** Selects or deselects one example (with its subagents or team). */
  async toggle(key: string, index: number): Promise<void> {
    const ds = this.dataset(key);
    if (!ds) return;
    const willSelect = !ds.selected.includes(index);
    this.telemetry?.trackEvent('trace_toggled', {
      source_id: ds.sourceId,
      selected: willSelect,
    });
    if (!willSelect) {
      const group = new Set(this.groupIndices(key, index));
      await this.setSelected(key, ds.selected.filter(i => !group.has(i)));
    } else {
      await this.setSelected(key, [...ds.selected, index], index);
    }
  }

  /** Selects just this example (and its group) across the whole workspace. */
  async selectOnly(key: string, index: number): Promise<void> {
    const sourceId = this.dataset(key)?.sourceId ?? (key.split(':')[0] || 'unknown');
    this.telemetry?.trackEvent('trace_selected_only', { source_id: sourceId });
    this.datasets.update(list => list.map(d => d.key === key ? d : { ...d, selected: [] }));
    await this.setSelected(key, [index], index);
  }

  clearSelection(): void {
    this.datasets.update(list => list.map(d => ({ ...d, selected: [] })));
    this.recompute();
  }

  /**
   * Sets a dataset's selected indices, adding each one's subagents or team,
   * and fetches any traces not loaded yet. `focus` becomes the active trace.
   */
  async setSelected(key: string, indices: number[], focus?: number): Promise<void> {
    const unique = [...new Set(indices)];
    this.patch(key, { selected: unique, error: undefined });
    await this.fetch(key, unique);
    // Fetching may have revealed groups; select whole groups.
    const ds = this.dataset(key);
    if (!ds) return;
    const expanded = [...new Set(ds.selected.flatMap(i => this.groupIndices(key, i)))];
    if (expanded.length !== ds.selected.length) {
      this.patch(key, { selected: expanded });
      await this.fetch(key, expanded);
    }
    this.recompute();
    if (focus !== undefined) this.focusEntryId.set(this.entries.get(`${key}#${focus}`)?.id ?? null);
  }

  /** Renames a trace; the name is kept in the browser for this dataset and example. */
  rename(entryId: string, title: string): void {
    const origin = this.entryOrigin.get(entryId);
    const trimmed = title.trim();
    if (!origin || !trimmed) return;
    const entryKey = `${origin.key}#${origin.index}`;
    this.renames = { ...this.renames, [entryKey]: trimmed };
    saveRenames(this.renames);
    const entry = this.entries.get(entryKey);
    if (entry) entry.title = trimmed;
    this.patchExample(origin.key, origin.index, { title: trimmed });
    this.recompute();
  }

  /** Example title shown in the sidebar, with any rename applied. */
  titleOf(key: string, example: ExampleSummary): string {
    return this.renames[`${key}#${example.index}`] ?? example.title;
  }

  /** Fetches and parses the traces at `indices` that aren't loaded yet. */
  private async fetch(key: string, indices: number[]): Promise<void> {
    const ds = this.dataset(key);
    const source = ds && this.source(ds.sourceId);
    if (!ds || !source) return;
    const missing = indices.filter(i => !this.entries.has(`${key}#${i}`));
    if (missing.length === 0) return;
    this.pendingFetches.update(n => n + 1);
    this.adjustFetching(key, 1);
    try {
      const records = await source.loadTraces(ds.datasetId, missing);
      missing.forEach((index, i) => {
        if (records[i]) this.addEntry(key, index, records[i]);
      });
      linkGroups(this.datasetEntries(key));
    } catch (err) {
      this.patch(key, { error: errorMessage(err) });
      this.error.set(`${ds.name}: ${errorMessage(err)}`);
    } finally {
      this.pendingFetches.update(n => n - 1);
      this.adjustFetching(key, -1);
    }
  }

  private adjustFetching(key: string, delta: number): void {
    this.datasets.update(list => list.map(d =>
      d.key === key ? { ...d, fetchingTraces: Math.max(0, d.fetchingTraces + delta) } : d));
  }

  private addEntry(key: string, index: number, record: TraceRecord): void {
    const entryKey = `${key}#${index}`;
    const id = hashString(entryKey);
    const data = this.traceLoader.parseTrace(record, id);
    const start = data.steps[0]?.timestamp;
    const rename = this.renames[entryKey];
    if (rename) data.title = rename;
    this.entries.set(entryKey, {
      id: data.id,
      title: rename ?? data.title,
      file: '',
      data,
      agents: data.agents || [],
      date: start ? new Date(start).toLocaleDateString([], { month: 'short', day: 'numeric' }) : undefined,
    });
    this.entryOrigin.set(data.id, { key, index });
  }

  private datasetEntries(key: string): TraceEntry[] {
    return [...this.entries.entries()].filter(([k]) => k.startsWith(`${key}#`)).map(([, e]) => e);
  }

  /** The example indices in `index`'s group (itself, subagents, team), among loaded traces. */
  private groupIndices(key: string, index: number): number[] {
    const entry = this.entries.get(`${key}#${index}`);
    if (!entry) return [index];
    const loaded = this.datasetEntries(key);
    return groupOf(loaded, entry.id)
      .map(id => this.entryOrigin.get(id)?.index)
      .filter((i): i is number => i !== undefined);
  }

  private recompute(): void {
    const out: TraceEntry[] = [];
    for (const ds of this.datasets()) {
      for (const index of ds.selected) {
        const entry = this.entries.get(`${ds.key}#${index}`);
        if (entry) out.push(entry);
      }
    }
    this.selectedEntries.set(out);
  }

  private patch(key: string, changes: Partial<LoadedDataset>): void {
    this.datasets.update(list => list.map(d => d.key === key ? { ...d, ...changes } : d));
  }

  private patchExample(key: string, index: number, changes: Partial<ExampleSummary>): void {
    this.datasets.update(list => list.map(d => d.key !== key ? d : {
      ...d,
      examples: d.examples.map(e => e.index === index ? { ...e, ...changes } : e),
    }));
  }
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { error?: { error?: unknown }; message?: unknown };
    if (typeof e.error?.error === 'string') return e.error.error;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}

function loadRenames(): Record<string, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RENAMES_KEY) || '{}') as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string> : {};
  } catch {
    return {};
  }
}

function saveRenames(renames: Record<string, string>): void {
  try {
    window.localStorage.setItem(RENAMES_KEY, JSON.stringify(renames));
  } catch (err) {
    console.warn('Failed to save trace renames', err);
  }
}
