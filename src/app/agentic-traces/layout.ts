/**
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
 * @fileoverview Top-level timeline layout. Turns the selected traces into one
 * `TraceLayout` per row (marks, backbone, file lane) plus the shared ruler.
 * Pure: the input traces are not modified.
 */

import { ReasoningTrace, ReasoningTraceStep, BASE_OFFSET, LayoutOutput, LayoutParams, TraceEntry, TraceLayout } from './layout-types';
import { getAgentColor } from './colors';
import { getStepTokens, stepAxisTokens, wordCount } from './layout-utils';
import { Mark, MarkTraceInput, buildMarks } from './marks';
import { buildBackboneLines } from './backbone-builder';
import { channelCenter, TRACK_HEIGHT } from './channels';
import { buildAxis, findIdleGaps, fillScaleMultiplier, computeTicks } from './x-scale';
import { extractFileEvents } from './file-events';
import { buildFileLane } from './file-lane';

export * from './layout-types';

/** Space reserved right of the timeline for channel labels. */
const LABEL_GUTTER = 140;

interface TraceMeta extends MarkTraceInput {
  title: string;
  data: ReasoningTrace;
  agentColor: string;
  /** Axis origin: first timestamp (time mode) or 0 (tokens mode). */
  startTime: number;
  /** Axis length in ms or tokens. */
  duration: number;
}

function getTraceMetadata(trace: TraceEntry, yAxisMode: 'time' | 'tokens', tokenTypes?: Set<string>): TraceMeta {
  const data = (trace.data as ReasoningTrace) || {};
  const steps = data.steps || [];

  const agentName = (data as any)?.agent?.name || 'Agent';
  const model = (data as any)?.agent?.model || steps.find(s => s.model)?.model;
  const agentColor = steps.find(s => s.color)?.color || getAgentColor(agentName, model);

  let startTime = 0;
  let duration = 0;
  if (yAxisMode === 'time') {
    const timestamps: number[] = [];
    steps.forEach((s: ReasoningTraceStep) => {
      if (s.timestamp) timestamps.push(new Date(s.timestamp).getTime());
      if (s.completedAt) timestamps.push(new Date(s.completedAt).getTime());
    });
    if (timestamps.length > 0) {
      startTime = Math.min(...timestamps);
      duration = Math.max(...timestamps) - startTime;
    }
  } else {
    duration = steps.reduce((sum, s) => sum + stepAxisTokens(s, tokenTypes), 0);
  }

  const maxStepTokens = Math.max(1, ...steps.map(s => s.token_usage
    ? getStepTokens(s.token_usage, tokenTypes)
    : wordCount(s.nodes?.map(n => n.text).join(' ') || (s as any).content || (s as any).reasoning_content)));

  return { id: trace.id, title: trace.title, data, steps, agentName, model, agentColor, startTime, duration, maxStepTokens };
}

/** Pixel [left, right] extents of drawn marks, used to find idle gaps. */
function markExtents(marks: Mark[]): Array<[number, number]> {
  return marks.filter(m => !m.hidden).map(m => [m.x, m.x + m.width] as [number, number]);
}

export function layoutTraces(params: LayoutParams): LayoutOutput {
  const { traces, selectedTraceIds, yAxisMode, hideGaps, selectedTokenTypes, containerWidth, stretch } = params;
  const compressGaps = hideGaps && yAxisMode === 'time';

  const avail = containerWidth && containerWidth > 0 ? containerWidth : 1000;
  const targetSpan = Math.max(400, avail - BASE_OFFSET - LABEL_GUTTER);

  const metas = [...selectedTraceIds]
    .map(id => traces.find(t => t.id === id))
    .filter((trace): trace is TraceEntry => !!trace?.data)
    .map(trace => getTraceMetadata(trace, yAxisMode, selectedTokenTypes));

  // All traces share one scale (so durations are comparable) unless stretched.
  const maxDuration = Math.max(1, ...metas.map(m => m.duration));
  const baseScale = targetSpan / maxDuration;

  // 1. Lay out each trace on a linear axis and find its idle gaps.
  const firstPass = metas.map(meta => {
    const scale = stretch && meta.duration > 0 ? targetSpan / meta.duration : baseScale;
    const { marks, maxX } = buildMarks(meta, buildAxis(meta.startTime, scale), yAxisMode, selectedTokenTypes);
    const gaps = yAxisMode === 'time' ? findIdleGaps(markExtents(marks), meta.startTime, scale, baseScale) : [];
    const fillMultiplier = compressGaps ? fillScaleMultiplier(gaps, scale, maxX, targetSpan) : 1;
    return { meta, scale, marks, maxX, gaps, fillMultiplier };
  });

  // 2. Compressing gaps frees up space: grow the scale to fill it. Unstretched
  //    traces grow by the same (smallest) factor so they stay comparable.
  const sharedMultiplier = firstPass.length > 0 ? Math.min(...firstPass.map(p => p.fillMultiplier)) : 1;

  const rows = firstPass.map(p => {
    const multiplier = (stretch || firstPass.length === 1) ? p.fillMultiplier : sharedMultiplier;
    const axis = buildAxis(p.meta.startTime, p.scale * multiplier, p.gaps, compressGaps);
    const { marks, maxX } = compressGaps ? buildMarks(p.meta, axis, yAxisMode, selectedTokenTypes) : p;
    const backbone = buildBackboneLines(p.meta.id, channelCenter('agent'), axis.gaps, maxX, p.meta.agentColor, marks);
    return { meta: p.meta, marks, backbone };
  });

  // 3. Ticks for the shared ruler (none when traces are stretched individually).
  let timeTicks: Array<{ label: string; x: number }> = [];
  if (!stretch) {
    if (compressGaps && firstPass.length > 0) {
      const scale = baseScale * sharedMultiplier;
      timeTicks = computeTicks('time', targetSpan / scale, scale, true);
    } else {
      timeTicks = computeTicks(yAxisMode, maxDuration, baseScale, hideGaps);
    }
  }

  // 4. Content dimensions from drawn marks.
  const drawn = rows.flatMap(r => r.marks).filter(m => !m.hidden);
  const contentWidth = Math.max(avail, ...drawn.map(m => m.x + m.width + LABEL_GUTTER));
  const contentHeight = Math.max(TRACK_HEIGHT, ...drawn.map(m => m.y + m.height)) + 100;

  const layouts: TraceLayout[] = rows.map(({ meta, marks, backbone }) => ({
    id: meta.id,
    title: meta.title,
    agentColor: meta.agentColor,
    marks,
    backbone,
    files: buildFileLane(extractFileEvents(meta.data), marks, contentWidth),
  }));

  return { traces: layouts, contentWidth, contentHeight, timeTicks };
}
