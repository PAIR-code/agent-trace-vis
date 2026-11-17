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
 * @fileoverview Where traces come from: the dataset list and fetching a
 * dataset's traces. Datasets are listed in `testdata/manifest.json`; each
 * dataset is a list of trace files relative to `testdata/`.
 * Parsing a trace record is `TraceLoaderService`'s job.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TraceEntry } from './layout-types';
import { TraceRecord } from './trace';
import { TraceLoaderService } from './trace-loader.service';
import { hashString } from './layout-utils';
import { linkGroups } from './agent-groups';

export interface DatasetItem {
  name: string;
  /** Unique id: the manifest id for local datasets. */
  file: string;
}

const TRACES_DIR = 'testdata/';

/** One local dataset in manifest.json. */
interface ManifestEntry {
  id: string;
  name: string;
  /** Trace files, relative to TRACES_DIR. */
  files: string[];
}

@Injectable({ providedIn: 'root' })
export class DatasetService {
  private manifest?: Promise<ManifestEntry[]>;

  constructor(private http: HttpClient, private traceLoader: TraceLoaderService) { }

  /** The datasets in manifest.json. */
  async listDatasets(): Promise<DatasetItem[]> {
    return (await this.getManifest()).map(ds => ({ name: ds.name, file: ds.id }));
  }

  /**
   * Fetches and parses every trace in a dataset. A local trace that fails to
   * load keeps its place in the list (URLs select traces by index) with no data.
   */
  async loadTraces(ds: DatasetItem): Promise<TraceEntry[]> {
    const entries = await this.fetchTraces(ds);
    linkGroups(entries);
    return entries;
  }

  private async fetchTraces(ds: DatasetItem): Promise<TraceEntry[]> {
    const files = (await this.getManifest()).find(m => m.id === ds.file)?.files ?? [];
    return Promise.all(files.map(async f => {
      const name = f.replace('.json', '');
      const id = hashString(name);
      try {
        const record = await firstValueFrom(this.http.get<TraceRecord>(TRACES_DIR + f));
        return this.toEntry(record, id, TRACES_DIR + f);
      } catch (err) {
        console.error(`Failed to load trace ${f}`, err);
        return { id, title: name, file: TRACES_DIR + f, data: null, agents: [] };
      }
    }));
  }

  /** manifest.json, fetched once. A missing manifest means no local datasets. */
  private getManifest(): Promise<ManifestEntry[]> {
    this.manifest ??= firstValueFrom(this.http.get<ManifestEntry[]>(TRACES_DIR + 'manifest.json'))
      .catch(err => {
        console.error('Failed to load trace manifest.json', err);
        return [];
      });
    return this.manifest;
  }

  /** `id` is used unless it needs hashing (see `parseTrace`). */
  private toEntry(record: TraceRecord, id: string, file = ''): TraceEntry {
    const data = this.traceLoader.parseTrace(record, id);
    const start = data.steps[0]?.timestamp;
    return {
      id: data.id,
      title: data.title,
      file,
      data,
      agents: data.agents || [],
      date: start ? new Date(start).toLocaleDateString([], { month: 'short', day: 'numeric' }) : undefined,
    };
  }
}
