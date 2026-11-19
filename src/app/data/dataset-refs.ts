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
 * @fileoverview The workspace's URL format: one `ds=<source>:<dataset>[:<indices>]`
 * parameter per loaded dataset, with the dataset id URI-encoded and the
 * selected example indices as a list such as `0,3,10-12`.
 */

/** A dataset (and selection) parsed from a `ds` URL parameter. */
export interface DatasetRef {
  sourceId: string;
  datasetId: string;
  indices: number[];
}

/** Formats one `ds` URL parameter value. */
export function formatDatasetRef(ref: DatasetRef): string {
  const base = `${ref.sourceId}:${encodeURIComponent(ref.datasetId)}`;
  return ref.indices.length ? `${base}:${ref.indices.join(',')}` : base;
}

/**
 * Parses one `ds` URL parameter value; null if malformed.
 *
 * Supports both URI-encoded dataset IDs (`s2:123%3Aspark_samples:0,1`) and
 * unencoded colons (`s2:123:spark_samples:0,1` or `s2:123:spark_samples`) by
 * checking whether the trailing colon segment parses as an index list.
 */
export function parseDatasetRef(value: string): DatasetRef | null {
  const firstColon = value.indexOf(':');
  if (firstColon <= 0) return null;
  const sourceId = value.slice(0, firstColon);
  const rest = value.slice(firstColon + 1);
  if (!rest || rest.startsWith(':')) return null;

  const lastColon = rest.lastIndexOf(':');
  let rawDatasetId = rest;
  let indices: number[] = [];

  if (lastColon > 0) {
    const tail = rest.slice(lastColon + 1);
    if (tail === '') {
      rawDatasetId = rest.slice(0, lastColon);
    } else {
      const parsed = parseIndices(tail);
      if (parsed !== null) {
        rawDatasetId = rest.slice(0, lastColon);
        indices = parsed;
      }
    }
  }

  let datasetId: string;
  try {
    datasetId = decodeURIComponent(rawDatasetId);
  } catch {
    return null;
  }
  if (!datasetId) return null;
  return { sourceId, datasetId, indices };
}

/**
 * Merges dataset references sharing the same `(sourceId, datasetId)` in
 * first-seen order, deduplicating their selected example indices.
 */
export function coalesceDatasetRefs(refs: readonly DatasetRef[]): DatasetRef[] {
  const byKey = new Map<string, DatasetRef>();
  for (const ref of refs) {
    const key = `${ref.sourceId}\0${ref.datasetId}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        sourceId: ref.sourceId,
        datasetId: ref.datasetId,
        indices: [...new Set(ref.indices)],
      });
    } else {
      existing.indices = [...new Set([...existing.indices, ...ref.indices])];
    }
  }
  return [...byKey.values()];
}

/**
 * Parses an index list such as "0,3,10-12"; null if any part is invalid. An
 * empty string is an empty list.
 */
export function parseIndices(spec: string, max = 500): number[] | null {
  const out: number[] = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (!part) continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const [lo, hi] = [Number(range[1]), Number(range[2])];
      if (hi < lo || hi - lo >= max) return null;
      for (let i = lo; i <= hi; i++) out.push(i);
    } else if (/^\d+$/.test(part)) {
      out.push(Number(part));
    } else {
      return null;
    }
  }
  return [...new Set(out)];
}
