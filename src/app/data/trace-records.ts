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

/** @fileoverview Parsing OpenTraces files and summarizing their records. */

import type { TraceRecord } from '../agentic-traces/trace';
import type { ExampleSummary } from './trace-source';
import { scalarMetadata } from '../agentic-traces/metadata-fields';

/** Summary fields read from a full trace record. */
export function summarizeRecord(index: number, record: TraceRecord, fallbackTitle = ''): ExampleSummary {
  const firstLine = (record.task?.description || '').trim().split('\n')[0];
  const summary: ExampleSummary = {
    index,
    title: (firstLine || fallbackTitle || record.trace_id || `#${index}`).slice(0, 300),
    stepCount: record.steps?.length ?? 0,
  };
  const id = record.trace_id || record.session_id;
  if (id) summary.id = id;
  const date = record.timestamp_start || record.steps?.[0]?.timestamp;
  if (date) summary.date = date;
  const outcome: { success?: boolean; reward?: number } = {};
  if (typeof record.outcome?.success === 'boolean') outcome.success = record.outcome.success;
  if (typeof record.outcome?.reward === 'number') outcome.reward = record.outcome.reward;
  if (outcome.success !== undefined || outcome.reward !== undefined) summary.outcome = outcome;
  const metadata = scalarMetadata(record.metadata);
  if (metadata) summary.metadata = metadata;
  const parent = (record.metadata as Record<string, unknown> | undefined)?.['parent_trace_id'];
  if (typeof parent === 'string' && parent) summary.parentId = parent;
  return summary;
}

/**
 * Trace records in a JSON or JSONL file's text: a JSON file holds one record
 * or a list; a JSONL file holds one record per line. Non-trace values are
 * skipped. Throws on invalid JSON.
 */
export function parseTraceFile(fileName: string, text: string): TraceRecord[] {
  const values: unknown[] = [];
  if (fileName.toLowerCase().endsWith('.jsonl')) {
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) values.push(JSON.parse(trimmed) as unknown);
    }
  } else {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) values.push(...(parsed as unknown[]));
    else values.push(parsed);
  }
  return values.filter(isTraceRecord);
}

function isTraceRecord(value: unknown): value is TraceRecord {
  if (!value || typeof value !== 'object') return false;
  const v = value as { steps?: unknown; trace_id?: unknown };
  return Array.isArray(v.steps) || typeof v.trace_id === 'string';
}
