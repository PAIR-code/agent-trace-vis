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
 * @fileoverview Trace files the user opens (or drops) from their computer. Files
 * are parsed in the browser and never uploaded. Each batch of files becomes one
 * dataset, cached in IndexedDB so it comes back after a refresh until the user
 * removes it from the sidebar.
 */

import { Injectable } from '@angular/core';
import { TraceRecord } from '../agentic-traces/trace';
import { parseTraceFile, summarizeRecord } from './trace-records';
import { DatasetInfo, ExamplesPage, SourceAction, TraceSource } from './trace-source';

const DB_NAME = 'agent-trace-vis';
const STORE = 'local-datasets';

interface LocalDataset {
  id: string;
  name: string;
  records: TraceRecord[];
}

@Injectable({ providedIn: 'root' })
export class LocalFilesSource implements TraceSource {
  readonly id = 'local';
  readonly label = 'LOCAL';
  readonly actions: SourceAction[] = [
    { label: 'Open local files…', run: () => this.pickFiles() },
  ];

  private readonly datasets = new Map<string, LocalDataset>();
  private loaded?: Promise<void>;

  async listDatasets(): Promise<DatasetInfo[]> {
    await this.loadCache();
    // Cached datasets come back automatically, like the samples.
    return [...this.datasets.values()].map(d => ({ id: d.id, name: d.name, isDefault: true }));
  }

  datasetName(datasetId: string): string {
    return this.datasets.get(datasetId)?.name ?? 'Local files (not cached)';
  }

  async listExamples(datasetId: string, offset: number, limit: number): Promise<ExamplesPage> {
    const ds = await this.get(datasetId);
    const examples = ds.records.slice(offset, offset + limit).map((r, i) => summarizeRecord(offset + i, r));
    return { examples, totalCount: ds.records.length, hasMore: offset + examples.length < ds.records.length };
  }

  async loadTraces(datasetId: string, indices: number[]): Promise<TraceRecord[]> {
    const ds = await this.get(datasetId);
    return indices.map(i => {
      const r = ds.records[i];
      if (!r) throw new Error(`Local trace #${i} doesn't exist.`);
      return r;
    });
  }

  onRemove(datasetId: string): void {
    this.datasets.delete(datasetId);
    void this.withStore('readwrite', store => store.delete(datasetId)).catch(err =>
      console.warn('Failed to remove cached local dataset', err));
  }

  /** Parses `files` into a new dataset. Throws if no file holds a trace. */
  async addFiles(files: File[]): Promise<DatasetInfo> {
    const traceFiles = files.filter(f => /\.jsonl?$/i.test(f.name));
    if (traceFiles.length === 0) throw new Error('Choose .json or .jsonl trace files.');
    const records: TraceRecord[] = [];
    for (const file of traceFiles.sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        records.push(...parseTraceFile(file.name, await file.text()));
      } catch (err) {
        throw new Error(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (records.length === 0) throw new Error('No OpenTraces records found in the chosen files.');
    const first = traceFiles[0].name;
    const name = traceFiles.length === 1 ? first : `${first} + ${traceFiles.length - 1} more`;
    const ds: LocalDataset = { id: `local-${Date.now().toString(36)}`, name, records };
    await this.loadCache();
    this.datasets.set(ds.id, ds);
    await this.withStore('readwrite', store => store.put(ds)).catch(err =>
      console.warn('Failed to cache local dataset; it will be gone after a refresh', err));
    return { id: ds.id, name: ds.name };
  }

  private pickFiles(): Promise<DatasetInfo | null> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.json,.jsonl,application/json';
      input.addEventListener('change', () => {
        const files = [...(input.files ?? [])];
        if (files.length === 0) {
          resolve(null);
          return;
        }
        this.addFiles(files).then(resolve, reject);
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  private async get(datasetId: string): Promise<LocalDataset> {
    await this.loadCache();
    const ds = this.datasets.get(datasetId);
    if (!ds) throw new Error('These local files are no longer cached. Open them again.');
    return ds;
  }

  private loadCache(): Promise<void> {
    this.loaded ??= this.withStore('readonly', store => store.getAll())
      .then(all => {
        for (const ds of all as LocalDataset[]) this.datasets.set(ds.id, ds);
      })
      .catch(err => console.warn('Local dataset cache unavailable', err));
    return this.loaded;
  }

  private withStore<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const request = op(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => {
          resolve(request.result);
          db.close();
        };
        request.onerror = () => {
          reject(request.error);
          db.close();
        };
      };
    });
  }
}
