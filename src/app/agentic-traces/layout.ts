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
 * @fileoverview Top-level timeline layout. Turns the selected traces into one
 * `TraceLayout` per row (marks, backbone, file lane) plus the shared ruler.
 * Pure: the input traces are not modified.
 */

import { ReasoningTrace, ReasoningTraceNode, ReasoningTraceStep, BASE_OFFSET, LayoutOutput, LayoutParams, TraceEntry, TraceLayout } from './layout-types';
import { getAgentColor } from './colors';
import { getStepTokens, stepAxisTokens, wordCount } from './layout-utils';
import { Mark, MarkTraceInput, buildMarks } from './marks';
import { buildBackboneLines } from './backbone-builder';
import { channelCenter, TRACK_HEIGHT } from './channels';
import { XAxis, buildAxis, findIdleGaps, fillScaleMultiplier, computeTicks } from './x-scale';
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
  /** Entry id of the launching trace, when it is also selected. */
  parentId?: string;
  parentToolCallId?: string;
  sourceId?: string;
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

  return {
    id: trace.id, title: trace.title, data, steps, agentName, model, agentColor, startTime, duration, maxStepTokens,
    parentId: trace.parentId, parentToolCallId: trace.parentToolCallId, sourceId: data.sourceId,
  };
}

/** Pixel [left, right] extents of drawn marks, used to find idle gaps. */
function markExtents(marks: Mark[]): Array<[number, number]> {
  return marks.filter(m => !m.hidden).map(m => [m.x, m.x + m.width] as [number, number]);
}

// ─── Families ───────────────────────────────────────────────────────
//
// A trace and the subagents it launched share one axis, so a subagent's row
// lines up under the moment its parent launched it. In time mode that falls
// out of sharing the origin (timestamps are absolute); in tokens mode each
// subagent is offset to the parent's token count at the launching step.

interface FamilyMember {
  meta: TraceMeta;
  depth: number;
  parent?: TraceMeta;
  /** Added to the member's own axis positions (tokens mode only). */
  offset: number;
}

interface Family {
  members: FamilyMember[];  // depth-first, root first
  /** Axis origin and length covering every member. */
  start: number;
  duration: number;
}

/** Whether a node (or its mark) is the tool call that launched `child`. */
function launchedChild(node: Pick<ReasoningTraceNode, 'data'>, child: TraceMeta): boolean {
  const tc = node.data?.toolCall;
  return !!tc && (tc.tool_call_id === child.parentToolCallId ||
    (!!child.sourceId && Array.isArray(tc.subagent_trajectory_refs) && tc.subagent_trajectory_refs.includes(child.sourceId)));
}

/** Parent's cumulative tokens through the step that launched `child`, or 0 if that step isn't found. */
function launchTokens(parent: TraceMeta, child: TraceMeta, tokenTypes?: Set<string>): number {
  let tokens = 0;
  for (const step of parent.steps) {
    tokens += stepAxisTokens(step, tokenTypes);
    if (step.nodes.some(n => launchedChild(n, child))) return tokens;
  }
  return 0;
}

/** Groups the selected traces into families, keeping the selection's order of roots. */
function buildFamilies(metas: TraceMeta[], yAxisMode: 'time' | 'tokens', tokenTypes?: Set<string>): Family[] {
  const byId = new Map(metas.map(m => [m.id, m]));
  const children = new Map<string, TraceMeta[]>();
  const roots: TraceMeta[] = [];
  for (const m of metas) {
    const parent = m.parentId ? byId.get(m.parentId) : undefined;
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), m]);
    else roots.push(m);
  }

  return roots.map(root => {
    const members: FamilyMember[] = [];
    const visit = (meta: TraceMeta, depth: number, parent?: TraceMeta, parentOffset = 0) => {
      const offset = parent && yAxisMode === 'tokens' ? parentOffset + launchTokens(parent, meta, tokenTypes) : 0;
      members.push({ meta, depth, parent, offset });
      for (const c of children.get(meta.id) ?? []) visit(c, depth + 1, meta, offset);
    };
    visit(root, 0);

    // Time mode: the earliest timestamp in the family (ignoring traces with
    // none). Tokens mode: 0, with members offset into it.
    const timed = members.filter(m => m.meta.duration > 0 || m.meta.startTime > 0);
    const start = yAxisMode === 'time' && timed.length > 0 ? Math.min(...timed.map(m => m.meta.startTime)) : 0;
    const end = Math.max(start, ...members.map(m =>
      yAxisMode === 'time' ? m.meta.startTime + m.meta.duration : m.offset + m.meta.duration));
    return { members, start, duration: end - start };
  });
}

/** The family's axis as seen by one member: shifted by its offset. */
function memberAxis(axis: XAxis, offset: number): XAxis {
  return offset === 0 ? axis : { ...axis, toX: (t: number) => axis.toX(t + offset) };
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

  const families = buildFamilies(metas, yAxisMode, selectedTokenTypes);

  // All families share one scale (so durations are comparable) unless stretched.
  const maxDuration = Math.max(1, ...families.map(f => f.duration));
  const baseScale = targetSpan / maxDuration;

  // 1. Lay out each family on a linear axis and find its idle gaps. Gaps are
  //    idle for the whole family: a parent waiting on a subagent isn't idle.
  const firstPass = families.map(family => {
    const scale = stretch && family.duration > 0 ? targetSpan / family.duration : baseScale;
    const linear = buildAxis(family.start, scale);
    const members = family.members.map(m => ({
      ...m, ...buildMarks(m.meta, memberAxis(linear, m.offset), yAxisMode, selectedTokenTypes),
    }));
    const maxX = Math.max(...members.map(m => m.maxX));
    const gaps = yAxisMode === 'time'
      ? findIdleGaps(members.flatMap(m => markExtents(m.marks)), family.start, scale, baseScale) : [];
    const fillMultiplier = compressGaps ? fillScaleMultiplier(gaps, scale, maxX, targetSpan) : 1;
    return { family, scale, members, gaps, fillMultiplier };
  });

  // 2. Compressing gaps frees up space: grow the scale to fill it. Unstretched
  //    families grow by the same (smallest) factor so they stay comparable.
  const sharedMultiplier = firstPass.length > 0 ? Math.min(...firstPass.map(p => p.fillMultiplier)) : 1;

  const rows = firstPass.flatMap(p => {
    const multiplier = (stretch || firstPass.length === 1) ? p.fillMultiplier : sharedMultiplier;
    const axis = buildAxis(p.family.start, p.scale * multiplier, p.gaps, compressGaps);
    const laid = p.members.map(m => ({
      ...m, ...(compressGaps ? buildMarks(m.meta, memberAxis(axis, m.offset), yAxisMode, selectedTokenTypes) : m),
    }));
    const marksOf = new Map(laid.map(m => [m.meta.id, m.marks]));
    return laid.map(m => {
      // A subagent's row branches off where its parent launched it: the x of the
      // parent's launching tool-call mark (which the connector's dot replaces),
      // else the subagent's own first mark.
      const launch = m.parent ? marksOf.get(m.parent.id)?.find(k => launchedChild(k, m.meta)) : undefined;
      if (launch) launch.hidden = true;
      const drawnX = m.marks.filter(k => !k.hidden).map(k => k.x);
      const startX = launch ? launch.x + launch.width / 2
        : m.parent ? (drawnX.length > 0 ? Math.min(...drawnX) : BASE_OFFSET) : BASE_OFFSET;
      const backbone = buildBackboneLines(m.meta.id, channelCenter('agent'), axis.gaps, m.maxX, m.meta.agentColor, m.marks, startX);
      return { meta: m.meta, marks: m.marks, backbone, depth: m.depth, parent: m.parent ? { id: m.parent.id, x: startX } : undefined };
    });
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

  const layouts: TraceLayout[] = rows.map(({ meta, marks, backbone, depth, parent }) => ({
    id: meta.id,
    title: meta.title,
    agentColor: meta.agentColor,
    marks,
    backbone,
    files: buildFileLane(extractFileEvents(meta.data), marks, contentWidth),
    depth,
    parent,
  }));

  return { traces: layouts, contentWidth, contentHeight, timeTicks };
}
