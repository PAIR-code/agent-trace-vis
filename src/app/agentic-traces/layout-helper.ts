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
 * @fileoverview Top-level layout orchestrator — computes node positions
 * (x = time), backbone lines, and content dimensions for the trace visualization.
 */

import { TraceNodeType, TraceNodeColumn, ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, ReasoningStepType, BASE_OFFSET } from './layout-types';
import { getAgentColor } from './colors';
import { LayoutOutput, LayoutParams, VisNode, BackboneLine } from './layout-types';
import { getStepTokens, stepAxisTokens } from './layout-utils';
import { NodeBuildContext, buildThinkingNode, buildResponseNode, buildDefaultNode, buildRateLimitNode, buildThinkingAreaNodes } from './node-builders';
import { buildBackboneLines } from './backbone-builder';
import { channelCenter, TRACK_HEIGHT } from './channels';
import { XAxis, buildAxis, findIdleGaps, fillScaleMultiplier, computeTicks } from './x-scale';

export * from './layout-types';
export { sanitizeId } from './layout-utils';

function getTraceMetadata(trace: any, yAxisMode: string, selectedTokenTypes?: Set<string>) {
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
  } else if (yAxisMode === 'tokens') {
    duration = steps.reduce((sum, s) => sum + stepAxisTokens(s, selectedTokenTypes), 0);
  }

  const stepTokensList = steps.map((s: ReasoningTraceStep) => {
    let tok = getStepTokens(s.token_usage, selectedTokenTypes);
    if (tok === 0 && !s.token_usage) {
      const text = s.nodes?.map(n => n.text).join(' ') || (s as any).content || (s as any).reasoning_content || '';
      tok = text.split(/\s+/).filter((w: string) => w.length > 0).length;
    }
    return tok;
  });
  const maxTokens = Math.max(...stepTokensList, 1);

  return { steps, agentName, model, agentColor, startTime, duration, maxTokens };
}

/** Space reserved right of the timeline for channel labels. */
const LABEL_GUTTER = 140;

type TraceMeta = ReturnType<typeof getTraceMetadata>;

/** Builds all nodes for one trace, positioned on the given axis. */
function buildTraceNodes(
  trace: any,
  meta: TraceMeta,
  axis: XAxis,
  yAxisMode: 'time' | 'tokens',
  selectedTokenTypes?: Set<string>
): { nodes: VisNode[]; maxX: number } {
  const { steps, agentName, model, maxTokens } = meta;
  const traceNodes: VisNode[] = [];
  let currentY = BASE_OFFSET;
  let cumulativeTokens = 0;
  let traceMaxX = 20;

  steps.forEach((step: ReasoningTraceStep, index: number) => {
    const numNodes = step.nodes.length;
    const stepAgentColor = step.color || getAgentColor(step.agentName || agentName, step.model || model);

    let currentTs = step.timestamp ? new Date(step.timestamp).getTime() : NaN;
    let completedTs = step.completedAt ? new Date(step.completedAt).getTime() : NaN;

    if (isNaN(completedTs) && index < steps.length - 1) {
      const nextStep = steps[index + 1];
      if (nextStep.stepType !== ReasoningStepType.USER_INPUT && step.stepType !== ReasoningStepType.USER_INPUT) {
        completedTs = nextStep.timestamp ? new Date(nextStep.timestamp).getTime() : NaN;
      }
    }

    const stepDuration = (!isNaN(currentTs) && !isNaN(completedTs)) ? completedTs - currentTs : 0;

    const stepTokens = stepAxisTokens(step, selectedTokenTypes);

    if (yAxisMode === 'tokens') {
      currentTs = cumulativeTokens;
      completedTs = cumulativeTokens + stepTokens;
    }

    const stepNodeHeight = stepDuration > 0 ? Math.max(12, (stepDuration * axis.scale) / numNodes) : 12;

    const ctx: NodeBuildContext = {
      yAxisMode,
      toX: axis.toX,
      stepAgentColor,
      traceId: trace.id,
      nodeW: 12,
      maxTokens,
      selectedTokenTypes,
      step,
      numNodes,
      stepDuration: yAxisMode === 'tokens' ? stepTokens : stepDuration,
      currentTs,
      completedTs,
      stepNodeHeight,
    };

    step.nodes.forEach((an: ReasoningTraceNode, nodeIndex: number) => {
      if (an.text?.includes("servers are experiencing high traffic") ||
          an.text?.includes("retryable error from model provider")) {
        const result = buildRateLimitNode(ctx, currentY, an);
        traceNodes.push(result.node);
        currentY = result.nextY;
      } else {
        const col = (an.type === TraceNodeType.SYSTEM || an.type === TraceNodeType.TOOL_CALL)
          ? TraceNodeColumn.AGENT
          : an.column;
        const nodeGap = nodeIndex > 0 ? 0 : 12;

        let result;
        if (an.type === TraceNodeType.THINKING) {
          result = buildThinkingNode(ctx, currentY, an.id, an.text, nodeIndex, nodeGap, an);
        } else if (an.type === TraceNodeType.RESPONSE) {
          result = buildResponseNode(ctx, currentY, an.id, 'user', an.text, nodeIndex, nodeGap, an);
        } else {
          result = buildDefaultNode(ctx, currentY, an.id, an.type, col, an.text, nodeIndex, nodeGap, an);
        }
        traceNodes.push(result.node);
        currentY = result.nextY;
        if (result.nodeBottom > traceMaxX) traceMaxX = result.nodeBottom;
      }
    });

    if (yAxisMode === 'tokens') {
      cumulativeTokens += stepTokens;
    }
  });

  return { nodes: traceNodes, maxX: traceMaxX };
}

/** Pixel [left, right] extents of visible nodes. Thinking nodes span their whole step. */
function nodeExtents(nodes: VisNode[]): Array<[number, number]> {
  return nodes
    .filter(n => !n.hidden)
    .map(n => [(n as any).timeBasedX ?? n.x, (n as any).timeBasedEndX ?? n.x + n.width] as [number, number]);
}

export function calculateTraceLayout(params: LayoutParams): LayoutOutput {
  const { traces, selectedTraceIds, yAxisMode, hideGaps, selectedTokenTypes, containerWidth, stretch } = params;
  const compressGaps = hideGaps && yAxisMode === 'time';

  const avail = containerWidth && containerWidth > 0 ? containerWidth : 1000;
  const targetSpan = Math.max(400, avail - BASE_OFFSET - LABEL_GUTTER);

  const items = [...selectedTraceIds]
    .map(id => traces.find(t => t.id === id))
    .filter(trace => trace && trace.data)
    .map(trace => {
      const meta = getTraceMetadata(trace, yAxisMode, selectedTokenTypes);
      trace.agentColor = meta.agentColor;
      return { trace, meta };
    });

  // All traces share one scale (so durations are comparable) unless stretched.
  const maxDuration = Math.max(1, ...items.map(i => i.meta.duration));
  const baseScale = targetSpan / maxDuration;

  // 1. Lay out each trace on a linear axis and find its idle gaps.
  const firstPass = items.map(({ trace, meta }) => {
    const scale = stretch && meta.duration > 0 ? targetSpan / meta.duration : baseScale;
    const { nodes, maxX } = buildTraceNodes(trace, meta, buildAxis(meta.startTime, scale), yAxisMode, selectedTokenTypes);
    const gaps = yAxisMode === 'time' ? findIdleGaps(nodeExtents(nodes), meta.startTime, scale, baseScale) : [];
    const fillMultiplier = compressGaps ? fillScaleMultiplier(gaps, scale, maxX, targetSpan) : 1;
    return { trace, meta, scale, nodes, maxX, gaps, fillMultiplier };
  });

  // 2. Compressing gaps frees up space: grow the scale to fill it. Unstretched
  //    traces grow by the same (smallest) factor so they stay comparable.
  const sharedMultiplier = firstPass.length > 0 ? Math.min(...firstPass.map(p => p.fillMultiplier)) : 1;

  const allNodes: VisNode[] = [];
  const backboneLines: BackboneLine[] = [];

  for (const p of firstPass) {
    const multiplier = (stretch || firstPass.length === 1) ? p.fillMultiplier : sharedMultiplier;
    const axis = buildAxis(p.meta.startTime, p.scale * multiplier, p.gaps, compressGaps);
    const { nodes, maxX } = compressGaps
      ? buildTraceNodes(p.trace, p.meta, axis, yAxisMode, selectedTokenTypes)
      : p;

    const cy = channelCenter('agent');
    const sortedNodes = nodes.filter(n => !n.hidden).sort((a, b) => a.x - b.x);
    const thinkingAreaNodes = buildThinkingAreaNodes(p.trace.id, sortedNodes, cy, yAxisMode, selectedTokenTypes);
    const traceBackbone = buildBackboneLines(p.trace.id, cy, axis.gaps, maxX, p.meta.agentColor, sortedNodes);

    p.trace.nodes = nodes;
    p.trace.thinkingAreaNodes = thinkingAreaNodes;
    p.trace.backboneLines = traceBackbone;

    allNodes.push(...thinkingAreaNodes, ...nodes);
    backboneLines.push(...traceBackbone);
  }

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

  // 4. Content dimensions from visible nodes.
  const visibleNodes = allNodes.filter(n => !n.hidden);
  const contentWidth = visibleNodes.length > 0
    ? Math.max(Math.max(...visibleNodes.map(n => n.x + n.width)) + LABEL_GUTTER, avail)
    : avail;
  const maxContentHeight = visibleNodes.length > 0
    ? Math.max(TRACK_HEIGHT, Math.max(...visibleNodes.map(n => n.y + n.height)))
    : TRACK_HEIGHT;

  return {
    nodes: allNodes,
    backboneLines,
    contentWidth,
    contentHeight: maxContentHeight + 100,
    timeTicks,
  };
}
