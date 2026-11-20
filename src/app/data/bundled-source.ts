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
 * @fileoverview The sample datasets served with the app: `testdata/manifest.json`
 * lists datasets, each a list of trace files relative to `testdata/`. They're
 * offered as demo traces in the "Add dataset" menu.
 */

import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TraceRecord } from '../agentic-traces/trace';
import { summarizeRecord } from './trace-records';
import { DatasetInfo, ExamplesPage, TraceSource } from './trace-source';

const TRACES_DIR = 'testdata/';

/** One dataset in manifest.json. */
interface ManifestEntry {
  id: string;
  name: string;
  /** Trace files, relative to TRACES_DIR. */
  files: string[];
}

@Injectable({ providedIn: 'root' })
export class BundledSource implements TraceSource {
  readonly id = 'bundled';
  readonly label = 'SAMPLE';

  private readonly http = inject(HttpClient);
  private manifest?: Promise<ManifestEntry[]>;
  /** Dataset id -> its records (one per file; null if the file failed to load). */
  private readonly records = new Map<string, Promise<Array<TraceRecord | null>>>();

  async listDatasets(): Promise<DatasetInfo[]> {
    return (await this.getManifest()).map(m => ({ id: m.id, name: m.name, isDemo: true }));
  }

  datasetName(datasetId: string): string {
    return datasetId;
  }

  async listExamples(datasetId: string, offset: number, limit: number): Promise<ExamplesPage> {
    const entry = (await this.getManifest()).find(m => m.id === datasetId);
    if (!entry) throw new Error(`No sample dataset "${datasetId}".`);
    const records = await this.getRecords(entry);
    const examples = records.slice(offset, offset + limit).map((r, i) => {
      const file = entry.files[offset + i];
      const name = file.split('/').pop()?.replace(/\.jsonl?$/, '') ?? file;
      return r ? summarizeRecord(offset + i, r, name) : { index: offset + i, title: `${name} (failed to load)` };
    });
    return { examples, totalCount: records.length, hasMore: offset + examples.length < records.length };
  }

  async loadTraces(datasetId: string, indices: number[]): Promise<TraceRecord[]> {
    const entry = (await this.getManifest()).find(m => m.id === datasetId);
    if (!entry) throw new Error(`No sample dataset "${datasetId}".`);
    const records = await this.getRecords(entry);
    return indices.map(i => {
      const r = records[i];
      if (!r) throw new Error(`Sample trace ${datasetId} #${i} is missing or failed to load.`);
      return r;
    });
  }

  /** manifest.json, fetched once. A missing manifest means no sample datasets. */
  private getManifest(): Promise<ManifestEntry[]> {
    this.manifest ??= firstValueFrom(this.http.get<ManifestEntry[]>(TRACES_DIR + 'manifest.json'))
      .catch(err => {
        console.error('Failed to load trace manifest.json', err);
        return [];
      });
    return this.manifest;
  }

  private getRecords(entry: ManifestEntry): Promise<Array<TraceRecord | null>> {
    let records = this.records.get(entry.id);
    if (!records) {
      records = Promise.all(entry.files.map(f =>
        firstValueFrom(this.http.get<TraceRecord>(TRACES_DIR + f)).catch(err => {
          console.error(`Failed to load trace ${f}`, err);
          return null;
        })));
      this.records.set(entry.id, records);
    }
    return records;
  }
}
