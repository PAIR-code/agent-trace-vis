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
 * @fileoverview Top-level layout orchestrator — computes node positions natively
 * in horizontal (row) layout, backbone lines, and SVG dimensions for the trace visualization.
 */

import { TraceNodeType, TraceNodeColumn, ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, ReasoningStepType, BASE_OFFSET } from './layout-types';
import { getAgentColor, COLORS } from './colors';
import { getNodeVisualConfig } from './node-rendering-helper';
import { LayoutOutput, LayoutParams, VisNode, BackboneLine } from './layout-types';
import { sanitizeId, getStepTokens } from './layout-utils';
import { NodeBuildContext, buildThinkingNode, buildResponseNode, buildDefaultNode, buildRateLimitNode, buildThinkingAreaNodes } from './node-builders';
import { buildBackboneLines } from './backbone-builder';
import { computeTimeAxis } from './time-axis';
import { compressGaps } from './gap-compressor';
import { applyRowLayout } from './row-layout';

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
    let runningSum = 0;
    steps.forEach((s: ReasoningTraceStep) => {
      let tok = getStepTokens(s.token_usage, selectedTokenTypes);
      if (tok === 0 && !s.token_usage) {
        const text = s.nodes?.map(n => n.text).join(' ') || (s as any).content || (s as any).reasoning_content || '';
        tok = text.split(/\s+/).filter((w: string) => w.length > 0).length;
      }
      runningSum += tok;
    });
    duration = runningSum;
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

function layoutSingleTrace(
  trace: any,
  meta: ReturnType<typeof getTraceMetadata>,
  scale: number,
  baseScale: number,
  yAxisMode: 'time' | 'tokens',
  hideGaps: boolean,
  selectedTokenTypes?: Set<string>
) {
  const { steps, agentName, model, agentColor, startTime, maxTokens } = meta;
  const cols = { user: { center: 23.33 }, agent: { center: 70 }, tools: { center: 116.66 } };
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

    let stepTokens = getStepTokens(step.token_usage, selectedTokenTypes);
    if (stepTokens === 0) {
      const text = step.nodes?.map(n => n.text).join(' ') || (step as any).content || (step as any).reasoning_content || '';
      stepTokens = text.split(/\s+/).filter((w: string) => w.length > 0).length;
    }

    if (yAxisMode === 'tokens') {
      currentTs = cumulativeTokens;
      completedTs = cumulativeTokens + stepTokens;
    }

    const stepNodeHeight = stepDuration > 0 ? Math.max(12, (stepDuration * scale) / numNodes) : 12;

    const ctx: NodeBuildContext = {
      cols,
      rows: cols,
      yAxisMode,
      traceScale: scale,
      startTime,
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
        if (traceNodes.length > 0) {
          (traceNodes[traceNodes.length - 1] as any).followedByRateLimit = true;
        }
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

  const { waitingRects, traceMaxX: compressedMaxX } = compressGaps({
    traceNodes,
    yAxisMode,
    scale,
    baseScale,
    hideGaps,
    traceMaxX,
  });

  const cx = cols.agent.center;
  const sortedNodes = [...traceNodes].filter(n => !n.hidden).sort((a, b) => a.x - b.x);
  const thinkingAreaNodes = buildThinkingAreaNodes(trace.id, sortedNodes, cx, yAxisMode, selectedTokenTypes);
  const backboneLines = buildBackboneLines(trace.id, cx, waitingRects, compressedMaxX, agentColor, sortedNodes);

  return {
    traceNodes,
    thinkingAreaNodes,
    backboneLines,
    traceMaxX: compressedMaxX,
    waitingRects,
  };
}

export function calculateTraceLayout(params: LayoutParams): LayoutOutput {
  const { traces, selectedTraceIds, yAxisMode, layoutMode, hideGaps, selectedTokenTypes, containerWidth, stretch } = params;

  const allNodes: VisNode[] = [];
  const backboneLines: BackboneLine[] = [];
  const idsArray = [...selectedTraceIds];

  const timeAxis = computeTimeAxis(traces, selectedTraceIds, yAxisMode, hideGaps, selectedTokenTypes, layoutMode, containerWidth, !!stretch);
  const { scale, baseScale } = timeAxis;
  let { timeTicks, intervalLabel } = timeAxis;

  const avail = containerWidth && containerWidth > 0 ? containerWidth : 1000;
  const targetSpan = layoutMode === 'row' ? Math.max(400, avail - BASE_OFFSET - 140) : 800;

  // 1. Gather metadata and initial scales for each trace
  const traceItems = idsArray.map(id => {
    const trace = traces.find(t => t.id === id);
    if (!trace || !trace.data) return null;
    const meta = getTraceMetadata(trace, yAxisMode, selectedTokenTypes);
    trace.agentColor = meta.agentColor;
    const initialScale = stretch ? (meta.duration > 0 ? targetSpan / meta.duration : scale) : scale;
    return { trace, id, meta, initialScale };
  }).filter(Boolean) as { trace: any; id: string; meta: ReturnType<typeof getTraceMetadata>; initialScale: number }[];

  // 2. Compute scale multipliers when hiding gaps in time mode
  const scaleMultipliers = new Map<string, number>();
  const initialLayouts = new Map<string, ReturnType<typeof layoutSingleTrace>>();

  if (hideGaps && yAxisMode === 'time') {
    traceItems.forEach(item => {
      let currentScale = item.initialScale;
      let layout = layoutSingleTrace(item.trace, item.meta, currentScale, baseScale, yAxisMode, hideGaps, selectedTokenTypes);

      // Refine scale so active segments fill available span
      for (let iter = 0; iter < 2; iter++) {
        const squiggles = layout.waitingRects.filter(r => r.isSquiggle).length;
        const squigglesWidth = squiggles * 30;
        const activeWidth = layout.traceMaxX - BASE_OFFSET - squigglesWidth;
        const targetActiveWidth = Math.max(50, targetSpan - BASE_OFFSET - squigglesWidth);

        if (activeWidth > 0) {
          const mult = targetActiveWidth / activeWidth;
          if (Math.abs(mult - 1) > 0.02) {
            currentScale *= mult;
            layout = layoutSingleTrace(item.trace, item.meta, currentScale, baseScale, yAxisMode, hideGaps, selectedTokenTypes);
          } else {
            break;
          }
        }
      }

      scaleMultipliers.set(item.id, currentScale / item.initialScale);
      initialLayouts.set(item.id, layout);
    });
  }

  const sharedMultiplier = scaleMultipliers.size > 0 ? Math.min(...scaleMultipliers.values()) : 1;

  // 3. Perform final layout for each trace
  let maxContentWidth = 1000;

  traceItems.forEach(item => {
    let result: ReturnType<typeof layoutSingleTrace>;

    if (hideGaps && yAxisMode === 'time') {
      const mult = (stretch || traceItems.length === 1) ? scaleMultipliers.get(item.id)! : sharedMultiplier;
      const initial = initialLayouts.get(item.id)!;
      const currentScaleMult = scaleMultipliers.get(item.id)!;

      if (Math.abs(mult - currentScaleMult) > 0.01) {
        result = layoutSingleTrace(item.trace, item.meta, item.initialScale * mult, baseScale, yAxisMode, hideGaps, selectedTokenTypes);
      } else {
        result = initial;
      }
    } else {
      result = layoutSingleTrace(item.trace, item.meta, item.initialScale, baseScale, yAxisMode, hideGaps, selectedTokenTypes);
    }

    if (result.traceMaxX > maxContentWidth) {
      maxContentWidth = result.traceMaxX;
    }

    item.trace.nodes = result.traceNodes;
    item.trace.thinkingAreaNodes = result.thinkingAreaNodes;
    item.trace.backboneLines = result.backboneLines;
    item.trace.maxTraceX = result.traceMaxX + 20;
    item.trace.maxTraceY = 140;

    allNodes.push(...result.thinkingAreaNodes, ...result.traceNodes);
    backboneLines.push(...result.backboneLines);
  });

  // 4. Update time ticks for active scale when hiding gaps without stretch
  if (hideGaps && yAxisMode === 'time' && !stretch && traceItems.length > 0) {
    const effectiveScale = scale * sharedMultiplier;
    const maxActiveDuration = targetSpan / Math.max(0.000001, effectiveScale);
    const niceIntervals = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
    const roughInterval = maxActiveDuration / 6;
    let interval = niceIntervals[0];
    for (let i = niceIntervals.length - 1; i >= 0; i--) {
      if (roughInterval >= niceIntervals[i]) {
        interval = niceIntervals[i];
        break;
      }
    }

    const seconds = Math.floor(interval / 1000);
    const minutes = Math.floor(seconds / 60);
    intervalLabel = minutes > 0 ? `${minutes}m` : `${seconds}s`;

    timeTicks = [];
    for (let d = 0; d <= maxActiveDuration; d += interval) {
      timeTicks.push({ label: '', x: BASE_OFFSET + d * effectiveScale });
    }
  }

  // 5. Normalize icon dimensions and apply row/column mode transformations
  allNodes.forEach(n => {
    if (n.hidden) return;
    const vc = getNodeVisualConfig(n);
    if (['diff', 'view', 'search'].includes(vc.type)) {
      n.width = 16;
      n.height = 16;
    }
  });

  const { contentWidth, maxContentHeight } = applyRowLayout({
    allNodes,
    backboneLines,
    timeTicks,
    yAxisMode,
    traces,
    selectedTraceIds,
    layoutMode,
    maxContentHeight: maxContentWidth,
    containerWidth,
  });

  return {
    nodes: allNodes,
    backboneLines,
    contentWidth,
    contentHeight: maxContentHeight + 100,
    timeTicks,
    timeUnitLabel: intervalLabel,
  };
}
