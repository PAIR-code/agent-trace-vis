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
 * @fileoverview Trace metadata fields for grouping and coloring. A trace's
 * `metadata` is free-form, so the fields worth grouping or coloring by are
 * guessed from the values: simple values (short strings, numbers, booleans)
 * that differ between traces. Few distinct values: categorical (group or
 * color by). Many numbers: numeric (color by, on a gradient).
 */

import { interpolateBlues } from 'd3';

export type MetaValue = string | number | boolean;

/** Strings longer than this are notes, not categories. */
const MAX_STRING_LENGTH = 120;
/** A field with more distinct values than this isn't categorical. */
export const MAX_CATEGORIES = 40;

/** Metadata keys the viewer uses for structure (links, timing, ...), never offered as fields. */
const STRUCTURAL_KEYS = new Set([
  'parent_trace_id', 'parent_tool_call_id', 'subagent_role', 'subagent_refs', 'team_id',
  'tool_kinds', 'step_timing', 'tool_timing', 'artifact_dirs', 'agent_messages', 'agent_colors',
  'reasoning_tokens', 'turn_token_usage',
]);

/** The simple values in a trace's metadata, by key. */
export function scalarMetadata(meta: unknown): Record<string, MetaValue> | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  const out: Record<string, MetaValue> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (STRUCTURAL_KEYS.has(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ||
        (typeof v === 'string' && v.length > 0 && v.length <= MAX_STRING_LENGTH)) {
      out[k] = v;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export interface MetaField {
  key: string;
  kind: 'categorical' | 'numeric';
  /** Distinct values, in display order (categorical fields only). */
  values: MetaValue[];
  /** Range of a numeric field. */
  min?: number;
  max?: number;
}

/** Orders that read naturally for common category names (lowest first). */
const LADDERS: string[][] = [
  ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  ['terse', 'concise', 'default', 'detailed', 'complete'],
  ['trash', 'bad', 'nah', 'okay', 'good', 'great'],
  ['xs', 's', 'm', 'l', 'xl'],
  ['small', 'medium', 'large'],
];

function ladderRank(v: string): [number, number] | null {
  const s = v.toLowerCase();
  for (let i = 0; i < LADDERS.length; i++) {
    const r = LADDERS[i].indexOf(s);
    if (r >= 0) return [i, r];
  }
  return null;
}

/**
 * Epoch ms of a date-like string: an ISO date or timestamp, or a batch label
 * like "2026-07-13 - 08-20" (date, then hour and minute). NaN otherwise.
 */
export function dateValue(v: MetaValue | undefined): number {
  if (typeof v !== 'string') return NaN;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T_]*-?[ T_]*(\d{1,2})[:-](\d{2}))?/.exec(v.trim());
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
}

function isDateField(values: MetaValue[]): boolean {
  return values.length > 0 && values.every(v => !isNaN(dateValue(v)));
}

/** Sort order for values of one field: numbers and booleans by value, known ladders in order, else text. */
export function compareMetaValues(a: MetaValue, b: MetaValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  const da = dateValue(a), db = dateValue(b);
  if (!isNaN(da) && !isNaN(db)) return da - db;
  const ra = ladderRank(String(a)), rb = ladderRank(String(b));
  if (ra && rb && ra[0] === rb[0]) return ra[1] - rb[1];
  return String(a).localeCompare(String(b), undefined, { numeric: true });
}

/** Whether a categorical field's values have a natural order (so a gradient fits). */
export function isOrdered(field: MetaField): boolean {
  if (field.kind === 'numeric') return true;
  const vs = field.values;
  if (vs.every(v => typeof v === 'number')) return true;
  if (isDateField(vs)) return true;
  const ranks = vs.map(v => ladderRank(String(v)));
  return vs.length > 1 && ranks.every(r => r && r[0] === ranks[0]![0]);
}

/**
 * The fields worth grouping or coloring by among some traces' metadata: ones
 * with at least two distinct values. Sorted by name.
 */
export function analyzeFields(rows: Array<Record<string, MetaValue> | undefined>): MetaField[] {
  const byKey = new Map<string, Set<MetaValue>>();
  for (const row of rows) {
    if (!row) continue;
    for (const [k, v] of Object.entries(row)) {
      let set = byKey.get(k);
      if (!set) byKey.set(k, set = new Set());
      set.add(v);
    }
  }
  const fields: MetaField[] = [];
  for (const [key, set] of byKey) {
    if (set.size < 2) continue;
    const values = [...set];
    if (values.length <= MAX_CATEGORIES) {
      fields.push({ key, kind: 'categorical', values: values.sort(compareMetaValues) });
    } else if (values.every(v => typeof v === 'number')) {
      const nums = values as number[];
      fields.push({ key, kind: 'numeric', values: [], min: Math.min(...nums), max: Math.max(...nums) });
    }
  }
  return fields.sort((a, b) => a.key.localeCompare(b.key));
}

/** Display text for a value. */
export function formatMetaValue(v: MetaValue | undefined): string {
  if (v === undefined) return '(none)';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '');
  return String(v);
}

/**
 * Distinct hues for categories. No reds (errors) or grays (files, tools,
 * users), so a category never reads as a status.
 */
const CATEGORY_PALETTE = [
  '#4e79a7', '#f28e2b', '#59a14f', '#b07aa1', '#edc948', '#76b7b2', '#9c755f', '#1f9bd1',
  '#8cd17d', '#d4a6c8', '#b6992d', '#499894', '#86bcb6', '#a0cbe8', '#ffbe7d', '#5d6fd8',
];

/** Color for missing values. */
export const MISSING_COLOR = '#cbd5e1';

/** Gradient position (0-1) to a color: light to dark blue. */
function gradient(t: number): string {
  return interpolateBlues(0.3 + 0.65 * Math.max(0, Math.min(1, t)));
}

/** A function from a field's values to colors: a gradient when ordered, else distinct hues. */
export function fieldColorScale(field: MetaField): (v: MetaValue | undefined) => string {
  if (field.kind === 'numeric') {
    const lo = field.min ?? 0, span = (field.max ?? 1) - lo || 1;
    return v => typeof v === 'number' ? gradient((v - lo) / span) : MISSING_COLOR;
  }
  const index = new Map(field.values.map((v, i) => [v, i]));
  if (isDateField(field.values)) {
    // Dates: spaced by time, so a gap between batches shows as a jump in shade.
    const times = field.values.map(dateValue);
    const lo = Math.min(...times), span = Math.max(...times) - lo || 1;
    return v => isNaN(dateValue(v)) ? MISSING_COLOR : gradient((dateValue(v) - lo) / span);
  }
  if (isOrdered(field)) {
    const n = Math.max(1, field.values.length - 1);
    return v => v === undefined || !index.has(v) ? MISSING_COLOR : gradient(index.get(v)! / n);
  }
  return v => v === undefined || !index.has(v) ? MISSING_COLOR
    : CATEGORY_PALETTE[index.get(v)! % CATEGORY_PALETTE.length];
}
