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
 * @fileoverview Per-trace reports of the enabled semantic searches: the
 * model's verdict and write-up for each trace, with the steps it cites
 * turned into links. Shown as dots on each row and in the side panel.
 */

import type { AnalysisLayer } from './analysis-layers.types';
import type { Mark } from './marks';

export type ReportState = 'found' | 'notFound' | 'failed' | 'running';

/** Part of a report: plain text, or a cited step linked to its mark. */
export interface ReportPart {
  text: string;
  nodeId?: string;
}

export interface TraceSearchReport {
  layerId: string;
  name: string;
  color: string;
  state: ReportState;
  report: string;
  parts: ReportPart[];
  /** Found, but with no step to highlight (e.g. something that never happens): shown on the row instead. */
  traceLevel?: boolean;
}

/** "step 12", "steps 3, 5 and 9", "Steps 4-6", "steps 44 through 51": each number becomes a link. */
const STEP_CITATION = /\bsteps?\s+\d+(?:\s*(?:,|-|–|—|&|and|or|to|through|thru|until)\s*\d+)*/gi;

/**
 * Splits a report into text and links to the steps it cites. Step N is the
 * trace's Nth mark, the numbering the search prompt used.
 */
export function linkSteps(report: string, stepNodeIds: string[]): ReportPart[] {
  const parts: ReportPart[] = [];
  let last = 0;
  for (const m of report.matchAll(STEP_CITATION)) {
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: report.slice(last, start) });
    let at = 0;
    for (const num of m[0].matchAll(/\d+/g)) {
      const i = num.index ?? 0;
      if (i > at) parts.push({ text: m[0].slice(at, i) });
      const nodeId = stepNodeIds[Number(num[0]) - 1];
      parts.push(nodeId ? { text: num[0], nodeId } : { text: num[0] });
      at = i + num[0].length;
    }
    if (at < m[0].length) parts.push({ text: m[0].slice(at) });
    last = start + m[0].length;
  }
  if (last < report.length) parts.push({ text: report.slice(last) });
  return parts;
}

/**
 * Reports of the enabled semantic searches, by trace id, in layer order. A
 * search still running gives every listed trace a `running` entry.
 */
export function traceSearchReports(layers: AnalysisLayer[], marks: Mark[],
                                   traceIds: string[]): Map<string, TraceSearchReport[]> {
  const out = new Map<string, TraceSearchReport[]>();
  const active = layers.filter(l => l.enabled && l.mode === 'semantic');
  if (active.length === 0) return out;
  const stepIds = new Map<string, string[]>();
  for (const m of marks) {
    let ids = stepIds.get(m.traceId);
    if (!ids) stepIds.set(m.traceId, ids = []);
    ids.push(m.id);
  }
  const add = (traceId: string, r: TraceSearchReport) => {
    let list = out.get(traceId);
    if (!list) out.set(traceId, list = []);
    list.push(r);
  };
  for (const layer of active) {
    const base = { layerId: layer.id, name: layer.name, color: layer.color };
    if (layer.loading) {
      for (const id of traceIds) add(id, { ...base, state: 'running', report: '', parts: [] });
      continue;
    }
    for (const r of layer.reports) {
      const state: ReportState = r.failed ? 'failed' : r.found ? 'found' : 'notFound';
      const ids = stepIds.get(r.traceId) ?? [];
      const traceLevel = state === 'found' && !ids.some(id => layer.results.has(id));
      add(r.traceId, { ...base, state, report: r.report, parts: linkSteps(r.report || '', ids),
                       ...(traceLevel ? { traceLevel } : {}) });
    }
  }
  return out;
}
