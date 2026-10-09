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
 * dataset's traces. Three sources:
 *   - local: `assets/data/traces/manifest.json` (written by generate-manifest.js);
 *   - Hugging Face presets (`HF_PRESETS`);
 *   - Hugging Face datasets the user imported (kept in localStorage).
 * Parsing a trace record is `TraceLoaderService`'s job.
 */

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { TraceEntry } from './layout-types';
import { TraceRecord } from './trace';
import { TraceLoaderService } from './trace-loader.service';
import { hashString } from './layout-utils';

export interface DatasetItem {
  name: string;
  /** Unique id: the manifest id for local datasets. */
  file: string;
  isRemote?: boolean;
  isImported?: boolean;
  repoId?: string;
  urls?: string[];
  maxTraces?: number;
}

export const HF_PRESETS: DatasetItem[] = [
  {
    name: 'OpenTraces/opentraces-runtime 🤗',
    file: 'opentraces-runtime-hf',
    isRemote: true,
    repoId: 'OpenTraces/opentraces-runtime',
    maxTraces: 10
  },
  {
    name: 'OpenTraces/opentraces-devtime 🤗',
    file: 'opentraces-devtime-hf',
    isRemote: true,
    repoId: 'OpenTraces/opentraces-devtime',
    maxTraces: 10
  },
  {
    name: 'OpenTraces/lambda-hermes-agent-reasoning-opentraces 🤗',
    file: 'opentraces-lambda-hermes-hf',
    isRemote: true,
    repoId: 'OpenTraces/lambda-hermes-agent-reasoning-opentraces',
    maxTraces: 10
  }
];

const TRACES_DIR = 'assets/data/traces/';
const IMPORTED_KEY = 'imported_datasets';
const REDACTED = '[redacted: model produced reasoning but content was withheld by provider]';

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

  /** Local datasets, then the Hugging Face presets, then user imports. */
  async listDatasets(): Promise<DatasetItem[]> {
    const local = (await this.getManifest()).map(ds => ({ name: ds.name, file: ds.id }));
    return [...local, ...HF_PRESETS, ...this.loadImported()];
  }

  /**
   * Fetches and parses every trace in a dataset. A local trace that fails to
   * load keeps its place in the list (URLs select traces by index) with no data.
   */
  async loadTraces(ds: DatasetItem): Promise<TraceEntry[]> {
    if (ds.isRemote || ds.isImported) {
      if (!ds.urls?.length && ds.repoId) ds.urls = await this.resolveRepositoryUrls(ds.repoId);
      const records = await this.loadRemoteDataset(ds.urls ?? [], ds.maxTraces || (ds.isRemote ? 5 : 50));
      return records.map(r => this.toEntry(r, r.trace_id || r.session_id || 'default'));
    }

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

  /** Remembers a user-imported dataset (newest first). */
  saveImported(ds: DatasetItem) {
    try {
      localStorage.setItem(IMPORTED_KEY, JSON.stringify([ds, ...this.loadImported()]));
    } catch (e) {
      console.error('Failed to save imported datasets to localStorage', e);
    }
  }

  /** URLs of the JSON / JSONL files in a Hugging Face dataset repo. */
  async resolveRepositoryUrls(repoId: string): Promise<string[]> {
    const metadata = await firstValueFrom(this.http.get<any>(`https://huggingface.co/api/datasets/${repoId}`));
    if (!metadata || !Array.isArray(metadata.siblings)) {
      throw new Error("Failed to fetch dataset files list from Hugging Face API.");
    }

    const files = metadata.siblings
      .map((s: any) => s.rfilename)
      .filter((f: string) => f.endsWith('.jsonl') || f.endsWith('.json'))
      .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (files.length === 0) {
      throw new Error("No JSON or JSONL files found in this Hugging Face dataset repository.");
    }
    return files.map((f: string) => `https://huggingface.co/datasets/${repoId}/resolve/main/${f}`);
  }

  /**
   * Up to `maxTraces` trace records from Hugging Face files. Tries the dataset
   * viewer's rows API first, then streams the files themselves.
   */
  async loadRemoteDataset(urls: string[], maxTraces: number): Promise<TraceRecord[]> {
    const repoId = urls[0]?.match(/datasets\/([^\/]+\/[^\/]+)\/resolve\//)?.[1];
    if (repoId) {
      const rowsApiUrl = `https://datasets-server.huggingface.co/rows?dataset=${repoId}&config=default&split=train&offset=0&length=${maxTraces}`;
      try {
        const response = await firstValueFrom(this.http.get<any>(rowsApiUrl));
        if (Array.isArray(response?.rows)) {
          return response.rows.map((r: any) => r.row as TraceRecord);
        }
      } catch (e) {
        console.warn(`Hugging Face rows API failed for ${repoId}, falling back to streaming file download:`, e);
      }
    }

    const records: TraceRecord[] = [];
    for (const url of urls) {
      if (records.length >= maxTraces) break;
      try {
        if (url.endsWith('.jsonl')) {
          await this.streamJsonl(url, records, maxTraces);
        } else {
          const text = await firstValueFrom(this.http.get(url, { responseType: 'text' }));
          for (const line of text.split('\n')) {
            const record = parseRecordLine(line);
            if (record) records.push(record);
          }
        }
      } catch (e) {
        console.error(`Error loading JSONL from ${url}:`, e);
      }
    }
    return records.slice(0, maxTraces);
  }

  /** Appends records from a JSONL file to `records`, stopping once there are `maxTraces`. */
  private async streamJsonl(url: string, records: TraceRecord[], maxTraces: number) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    if (!response.body) throw new Error('Response body is null');

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      while (records.length < maxTraces) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const record = parseRecordLine(line);
          if (record) records.push(record);
          if (records.length >= maxTraces) {
            await reader.cancel();
            break;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
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

  private loadImported(): DatasetItem[] {
    try {
      return JSON.parse(localStorage.getItem(IMPORTED_KEY) || '[]') as DatasetItem[];
    } catch (e) {
      console.error('Failed to load imported datasets from localStorage', e);
      return [];
    }
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

/** A trace record from one JSONL line, or null (blank, redacted, invalid or not a trace). */
function parseRecordLine(line: string): TraceRecord | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes(REDACTED)) return null;
  try {
    const record = JSON.parse(trimmed) as TraceRecord;
    return record && (record.steps || record.trace_id) ? record : null;
  } catch {
    return null;
  }
}
