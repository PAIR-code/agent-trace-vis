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

import { AxisMode, ReasoningTrace, ReasoningTraceNode, ReasoningTraceStep, BASE_OFFSET, InlineSubagents, LayoutOutput, LayoutParams, MAX_SUBAGENT_ROWS, TraceEntry, TraceLayout } from './layout-types';
import { getAgentColor } from './colors';
import { stepAxisLength, stepAxisTokens } from './layout-utils';
import { Mark, MarkTraceInput, buildMarks } from './marks';
import { buildBackboneLines } from './backbone-builder';
import { channelCenter, TRACK_HEIGHT } from './channels';
import { XAxis, buildAxis, findUserWaitGaps, fillScaleMultiplier, computeTicks } from './x-scale';
import { FileEvent, artifactNodes, extractFileEvents } from './file-events';
import { buildFileLane } from './file-lane';

export * from './layout-types';

/** Space reserved right of the timeline for channel labels. */
const LABEL_GUTTER = 140;

/** Minimum space kept right of the last drawn mark (clear of the row's reorder handle). */
const CONTENT_MARGIN = 40;

interface TraceMeta extends MarkTraceInput {
  title: string;
  data: ReasoningTrace;
  agentColor: string;
  /** Axis origin: first timestamp (time mode) or 0 (tokens / sequence mode). */
  startTime: number;
  /** Axis length in ms, tokens or nodes. */
  duration: number;
  /** Entry id of the launching trace, when it is also selected. */
  parentId?: string;
  parentToolCallId?: string;
  sourceId?: string;
  /** Team id, for a member of a team of peer agents. */
  teamId?: string;
  /** Every file the trace touched (file-events.ts); the files lane draws the non-artifact ones. */
  fileEvents: FileEvent[];
}

/** Whether a trace can be laid out on the time axis: at least one step has a timestamp. */
export function hasTimestamps(data: ReasoningTrace | null | undefined): boolean {
  return !!data?.steps?.some(s => s.timestamp || s.completedAt);
}

function getTraceMetadata(trace: TraceEntry, mode: AxisMode, tokenTypes?: Set<string>, colorOverride?: string): TraceMeta {
  const data = (trace.data as ReasoningTrace) || {};
  const steps = data.steps || [];

  const agentName = (data as any)?.agent?.name || 'Agent';
  const model = (data as any)?.agent?.model || steps.find(s => s.model)?.model;
  const agentColor = colorOverride ?? (steps.find(s => s.color)?.color || getAgentColor(agentName, model));

  let startTime = 0;
  let duration = 0;
  if (mode === 'time') {
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
    duration = steps.reduce((sum, s) => sum + stepAxisLength(s, mode, tokenTypes), 0);
  }

  const maxStepTokens = Math.max(1, ...steps.map(s => stepAxisTokens(s, tokenTypes)));

  const fileEvents = extractFileEvents(data);

  return {
    id: trace.id, title: trace.title, data, steps, agentName, model, agentColor, startTime, duration, maxStepTokens,
    parentId: trace.parentId, parentToolCallId: trace.parentToolCallId, sourceId: data.sourceId,
    teamId: trace.teamId,
    fileEvents, artifactNodes: artifactNodes(fileEvents),
    ...(colorOverride ? { colorOverride } : {}),
  };
}

// ─── Groups ─────────────────────────────────────────────────────────
//
// A trace and the subagents it launched share one axis, so a subagent's row
// lines up under the moment its parent launched it. In time mode that falls
// out of sharing the origin (timestamps are absolute). In tokens mode the
// axis counts everything the group spent: each subagent follows the step
// that launched it (siblings one after another, even if they ran in
// parallel), and the parent resumes once they're done.
//
// The selected members of a team of peer agents also form one group: every
// member is a root (depth 0, no offset), and in time mode they share the
// origin, so a message's send and read line up across their rows.

interface GroupMember {
  meta: TraceMeta;
  depth: number;
  parent?: TraceMeta;
  /** Added to the member's own axis positions (tokens mode only). */
  offset: number;
}

interface Group {
  members: GroupMember[];  // depth-first, root first
  /** Axis origin and length covering every member. */
  start: number;
  duration: number;
}

/** Whether a node (or its mark) is the tool call that launched `child`. */
function launchedChild(node: Pick<ReasoningTraceNode, 'data'>, child: TraceMeta): boolean {
  const tc = node.data?.toolCall;
  const refs: string[] = node.data?.subagentRefs ?? [];
  return !!tc && (tc.tool_call_id === child.parentToolCallId ||
    (!!child.sourceId && refs.includes(child.sourceId)));
}

/** Splits the selected traces into groups, keeping the selection's order of roots. */
function buildGroups(metas: TraceMeta[], mode: AxisMode, tokenTypes?: Set<string>): Group[] {
  const byId = new Map(metas.map(m => [m.id, m]));
  const children = new Map<string, TraceMeta[]>();
  const roots: TraceMeta[] = [];
  for (const m of metas) {
    const parent = m.parentId ? byId.get(m.parentId) : undefined;
    if (parent) children.set(parent.id, [...(children.get(parent.id) ?? []), m]);
    else roots.push(m);
  }

  // Each root starts a group, except that selected team members join the
  // first of them (the selection keeps them adjacent; see groupOrder).
  const rootSets: TraceMeta[][] = [];
  const byTeam = new Map<string, TraceMeta[]>();
  for (const root of roots) {
    const existing = root.teamId ? byTeam.get(root.teamId) : undefined;
    if (existing) { existing.push(root); continue; }
    const set = [root];
    rootSets.push(set);
    if (root.teamId) byTeam.set(root.teamId, set);
  }

  return rootSets.map(set => {
    const members: GroupMember[] = [];
    if (mode === 'time') {
      const visit = (meta: TraceMeta, depth: number, parent?: TraceMeta) => {
        members.push({ meta, depth, parent, offset: 0 });
        for (const c of children.get(meta.id) ?? []) visit(c, depth + 1, meta);
      };
      for (const root of set) visit(root, 0);
    } else {
      // Tokens / sequence: the axis counts everything the group spent, so a
      // trace's length includes its subagents'. Subagents run one after
      // another (even ones that ran in parallel) right after the step that
      // launched them, and the launcher's later steps wait until they finish.
      const totalOf = (meta: TraceMeta): number =>
        meta.duration + (children.get(meta.id) ?? []).reduce((sum, c) => sum + totalOf(c), 0);
      const visit = (meta: TraceMeta, depth: number, offset: number, parent?: TraceMeta) => {
        members.push({ meta, depth, parent, offset });
        const kids = children.get(meta.id) ?? [];
        if (kids.length === 0) return;
        const gaps = new Map<ReasoningTraceStep, number>();
        const placed = new Set<TraceMeta>();
        let at = offset;  // Axis position after the step so far, counting subagents inserted before it.
        for (const step of meta.steps) {
          at += stepAxisLength(step, mode, tokenTypes);
          for (const kid of kids) {
            if (placed.has(kid) || !step.nodes.some(n => launchedChild(n, kid))) continue;
            placed.add(kid);
            visit(kid, depth + 1, at, meta);
            const len = totalOf(kid);
            at += len;
            gaps.set(step, (gaps.get(step) ?? 0) + len);
          }
        }
        // Subagents whose launch isn't found go after the launcher's last step.
        for (const kid of kids) {
          if (placed.has(kid)) continue;
          visit(kid, depth + 1, at, meta);
          at += totalOf(kid);
        }
        meta.axisGapsAfter = gaps;
      };
      for (const root of set) visit(root, 0, 0);
    }

    // Time mode: the earliest timestamp in the group (ignoring traces with
    // none). Tokens / sequence mode: 0, with members offset into it.
    const timed = members.filter(m => m.meta.duration > 0 || m.meta.startTime > 0);
    const start = mode === 'time' && timed.length > 0 ? Math.min(...timed.map(m => m.meta.startTime)) : 0;
    const end = Math.max(start, ...members.map(m => mode === 'time' ? m.meta.startTime + m.meta.duration
      : m.offset + m.meta.duration + [...(m.meta.axisGapsAfter?.values() ?? [])].reduce((a, b) => a + b, 0)));
    return { members, start, duration: end - start };
  });
}

/** The group's axis as seen by one member: shifted by its offset. */
function memberAxis(axis: XAxis, offset: number): XAxis {
  return offset === 0 ? axis : { ...axis, toX: (t: number) => axis.toX(t + offset) };
}

export function layoutTraces(params: LayoutParams): LayoutOutput {
  const { traces, selectedTraceIds, yAxisMode: mode, showUserWait, selectedTokenTypes, containerWidth, stretch } = params;

  const avail = containerWidth && containerWidth > 0 ? containerWidth : 1000;
  const targetSpan = Math.max(400, avail - BASE_OFFSET - LABEL_GUTTER);

  const metas = [...selectedTraceIds]
    .map(id => traces.find(t => t.id === id))
    .filter((trace): trace is TraceEntry => !!trace?.data)
    .map(trace => getTraceMetadata(trace, mode, selectedTokenTypes, params.traceColors?.get(trace.id)));
  // By default, user wait gaps in time mode are compressed/hidden; checking "Show user wait" shows them uncompressed.
  const compressGaps = !showUserWait && mode === 'time';

  const groups = buildGroups(metas, mode, selectedTokenTypes);

  // All groups share one scale (so durations are comparable) unless stretched.
  const maxDuration = Math.max(1, ...groups.map(g => g.duration));
  const baseScale = targetSpan / maxDuration;

  // 1. Lay out each group on a linear axis and find its user wait gaps. Gaps
  //    are only periods spent waiting for the user to respond; tool calls,
  //    thinking, and subagent work do not create gaps.
  const firstPass = groups.map(group => {
    const scale = stretch && group.duration > 0 ? targetSpan / group.duration : baseScale;
    const linear = buildAxis(group.start, scale);
    const members = group.members.map(m => ({
      ...m, ...buildMarks(m.meta, memberAxis(linear, m.offset), mode, selectedTokenTypes),
    }));
    const maxX = Math.max(...members.map(m => m.maxX));
    const gaps = mode === 'time'
      ? findUserWaitGaps(members, group.start, scale, baseScale) : [];
    const fillMultiplier = compressGaps ? fillScaleMultiplier(gaps, scale, maxX, targetSpan) : 1;
    return { group, scale, members, gaps, fillMultiplier };
  });

  // 2. Compressing gaps frees up space: grow the scale to fill it. Unstretched
  //    groups grow by the same (smallest) factor so they stay comparable.
  const sharedMultiplier = firstPass.length > 0 ? Math.min(...firstPass.map(p => p.fillMultiplier)) : 1;

  const rows = firstPass.flatMap(p => {
    const multiplier = (stretch || firstPass.length === 1) ? p.fillMultiplier : sharedMultiplier;
    const axis = buildAxis(p.group.start, p.scale * multiplier, p.gaps, compressGaps);
    const laid = p.members.map(m => ({
      ...m, ...(compressGaps ? buildMarks(m.meta, memberAxis(axis, m.offset), mode, selectedTokenTypes) : m),
    }));
    const marksOf = new Map(laid.map(m => [m.meta.id, m.marks]));
    const groupId = laid[0].meta.id;
    return laid.map(m => {
      // A subagent's row branches off where its parent launched it: the x of the
      // parent's launching tool-call mark (which the connector's dot replaces),
      // else the subagent's own first mark.
      const launch = m.parent ? marksOf.get(m.parent.id)?.find(k => launchedChild(k, m.meta)) : undefined;
      if (launch) launch.hidden = true;
      const drawnX = m.marks.filter(k => !k.hidden).map(k => k.x);
      const startX = launch ? launch.x + launch.width / 2
        : m.parent ? (drawnX.length > 0 ? Math.min(...drawnX) : BASE_OFFSET) : BASE_OFFSET;
      const backbone = buildBackboneLines(m.meta.id, channelCenter('agent'), axis.gaps, m.maxX, m.meta.agentColor, m.marks, startX,
        !!m.meta.colorOverride);
      return { meta: m.meta, marks: m.marks, backbone, depth: m.depth, groupId,
               parent: m.parent ? { id: m.parent.id, x: startX } : undefined,
               launchId: launch?.id,
               launchKey: launch ? `${m.parent!.id}@${launch.timestamp ?? launch.stepRef?.timestamp ?? launch.id}` : undefined };
    });
  });

  // 3. Ticks for the shared ruler. None when traces are stretched individually
  //    (no shared scale) or on the sequence axis (no units worth labeling).
  //    With user-wait gaps hidden, the gaps take no width, so x is linear in
  //    the agent's active (working) time and the ruler labels that instead.
  let timeTicks: Array<{ label: string; x: number }> = [];
  if (!stretch && mode !== 'sequence') {
    if (compressGaps && firstPass.length > 0) {
      // Unstretched rows all use sharedMultiplier (one group: its own fill).
      const scale = baseScale * sharedMultiplier;
      timeTicks = computeTicks('time', targetSpan / scale, scale);
    } else {
      timeTicks = computeTicks(mode, maxDuration, baseScale);
    }
  }

  // 4. Content dimensions from drawn marks. The label gutter is already inside
  //    the axis span; marks that overrun the axis end (a last step with no end
  //    time places its actions after its timestamp) spill into it. Only grow
  //    the content when they'd otherwise be clipped.
  const drawn = rows.flatMap(r => r.marks).filter(m => !m.hidden);
  const contentWidth = Math.max(avail, ...drawn.map(m => m.x + m.width + CONTENT_MARGIN));
  const contentHeight = Math.max(TRACK_HEIGHT, ...drawn.map(m => m.y + m.height)) + 100;

  // "Subagents inline": each top-level row takes its subagents (at any depth)
  // as bars in one packed lane, and their file events in its files lane.
  const rootOf = new Map<string, string>();
  if (params.subagentsInline) {
    const parentOf = new Map(rows.map(r => [r.meta.id, r.parent?.id]));
    for (const r of rows) {
      let root = r.meta.id;
      for (let p = parentOf.get(root); p !== undefined && parentOf.has(p); p = parentOf.get(p)) root = p;
      rootOf.set(r.meta.id, root);
    }
  }
  const inlineOf = new Map<string, typeof rows>();
  for (const r of rows) {
    const root = rootOf.get(r.meta.id);
    if (root !== undefined && root !== r.meta.id) inlineOf.set(root, [...(inlineOf.get(root) ?? []), r]);
  }

  const layouts: TraceLayout[] = rows
    .filter(r => (rootOf.get(r.meta.id) ?? r.meta.id) === r.meta.id)
    .map(({ meta, marks, backbone, depth, parent, groupId }) => {
      const subs = inlineOf.get(meta.id) ?? [];
      const tints = new Map<string, string>();
      for (const s of subs) for (const m of s.marks) tints.set(m.id, s.meta.agentColor);
      // The calls that launched the inline subagents aren't shown as file
      // events: the subagents' own edits (tinted) stand for that work.
      const launchIds = new Set(subs.map(s => s.launchId).filter(id => id !== undefined));
      const events = [meta, ...subs.map(s => s.meta)]
        .flatMap(m => m.fileEvents.filter(e => !e.isArtifact && !launchIds.has(e.nodeId)));
      const allMarks = subs.length > 0 ? [...marks, ...subs.flatMap(s => s.marks)] : marks;
      return {
        id: meta.id,
        title: meta.title,
        agentColor: meta.agentColor,
        marks,
        backbone,
        files: buildFileLane(events, allMarks, contentWidth, mode, subs.length > 0 ? tints : undefined),
        depth,
        parent,
        groupId,
        ...(subs.length > 0 ? { subagents: packSubagents(subs) } : {}),
      };
    });

  return { traces: layouts, contentWidth, contentHeight, timeTicks };
}

/**
 * Bars for a row's inline subagents, packed into as few sub-rows as possible:
 * each takes the first sub-row free when it starts (a few px clear of the bar
 * before it), so the lane is as tall as the most subagents running at once.
 * Past MAX_SUBAGENT_ROWS, later ones overlap in the sub-row freed earliest.
 */
export function packSubagents(subs: Array<{ meta: TraceMeta; marks: Mark[]; parent?: { id: string; x: number }; launchKey?: string }>): InlineSubagents {
  const GAP = 4;
  // Subagents launched at the same moment (parallel calls, which the parent's
  // lanes spread out side by side) share one launch x: the earliest of them.
  const launchAt = new Map<string, number>();
  for (const s of subs) {
    if (s.launchKey === undefined || s.parent === undefined) continue;
    launchAt.set(s.launchKey, Math.min(launchAt.get(s.launchKey) ?? Infinity, s.parent.x));
  }
  const bars = subs.map(s => {
    // Its whole extent, file views and edits included (hidden from its lanes,
    // they're drawn in the files lane); not zero-width placeholders.
    const drawn = s.marks.filter(m => !m.hidden || m.width > 0);
    const x0 = drawn.length > 0 ? Math.min(...drawn.map(m => m.x)) : (s.parent?.x ?? BASE_OFFSET);
    const x1 = drawn.length > 0 ? Math.max(...drawn.map(m => m.x + Math.max(m.width, m.span ?? 0))) : x0;
    return { id: s.meta.id, title: s.meta.title, color: s.meta.agentColor, x0, x1: Math.max(x1, x0 + 4),
             launchX: (s.launchKey !== undefined ? launchAt.get(s.launchKey) : undefined) ?? s.parent?.x ?? x0, row: 0, mark: drawn[0] };
  }).sort((a, b) => Math.min(a.launchX, a.x0) - Math.min(b.launchX, b.x0));
  const ends: number[] = [];
  for (const bar of bars) {
    // A bar's row also holds the stub from its launch point, so pack from there.
    let row = ends.findIndex(end => end + GAP <= Math.min(bar.launchX, bar.x0));
    if (row < 0) {
      if (ends.length < MAX_SUBAGENT_ROWS) {
        row = ends.length;
        ends.push(0);
      } else {
        row = ends.indexOf(Math.min(...ends));
      }
    }
    ends[row] = Math.max(ends[row], bar.x1);
    bar.row = row;
  }
  return { bars, rows: Math.max(1, ends.length), marks: subs.flatMap(s => s.marks) };
}
