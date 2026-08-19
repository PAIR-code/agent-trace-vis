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

import { TraceNodeType, TraceNodeColumn, ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, BASE_OFFSET } from './layout-types';
import { getAgentColor, getDarkerAgentColor, COLORS } from './colors';
import { getNodeVisualConfig } from './node-rendering-helper';
import { LayoutOutput, LayoutParams, VisNode, BackboneLine } from './layout-types';
import { sanitizeId } from './layout-utils';
import { NodeBuildContext, buildThinkingNode, buildResponseNode, buildDefaultNode, buildRateLimitNode, buildThinkingAreaNodes, rebuildConnectionLines } from './node-builders';
import { buildBackboneLines } from './backbone-builder';
import { computeTimeAxis } from './time-axis';
import { compressGaps } from './gap-compressor';
import { applyRowLayout } from './row-layout';

export * from './layout-types';
export { sanitizeId } from './layout-utils';



function getStepTokens(usage: any, selectedTypes?: Set<string>): number {
  if (!usage) return 0;
  let sum = 0;
  if (!selectedTypes) {
    return (usage.input_tokens || 0) + (usage.output_tokens || 0) + (usage.cache_read_tokens || 0) + (usage.cache_write_tokens || 0);
  }
  if (selectedTypes.has('input_tokens')) sum += usage.input_tokens || 0;
  if (selectedTypes.has('output_tokens')) sum += usage.output_tokens || 0;
  if (selectedTypes.has('cache_read_tokens')) sum += usage.cache_read_tokens || 0;
  if (selectedTypes.has('cache_write_tokens')) sum += usage.cache_write_tokens || 0;
  return sum;
}

export function calculateTraceLayout(params: LayoutParams): LayoutOutput {
  const { traces, selectedTraceIds, yAxisMode, layoutMode, hideGaps, selectedTokenTypes, containerWidth, stretch } = params;

  const allNodes: VisNode[] = [];
  const backboneLines: BackboneLine[] = [];
  const nodeW = 12;
  const gap = 12; // horizontal gap between nodes
  let maxContentWidth = 1000;

  const idsArray = [...selectedTraceIds];

  const timeAxis = computeTimeAxis(traces, selectedTraceIds, yAxisMode, hideGaps, selectedTokenTypes, layoutMode, containerWidth, !!stretch);
  const { scale, baseScale, timeTicks, intervalLabel } = timeAxis;

  let targetSpan = 800;
  if (layoutMode === 'row') {
    const avail = containerWidth && containerWidth > 0 ? containerWidth : 1000;
    targetSpan = Math.max(400, avail - BASE_OFFSET - 140);
  }

  idsArray.forEach((id, traceIndex) => {
    const trace = traces.find(t => t.id === id);
    if (!trace || !trace.data) return;

    const data = trace.data;
    const waitingRects: any[] = [];
    const xOffset = 0; // Channel offset in Y space

    const cols = {
      user: { center: 23.33 },
      agent: { center: 70 },
      tools: { center: 116.66 },
    };

    let currentY = BASE_OFFSET; // current position along timeline X axis
    const steps = (data as ReasoningTrace).steps || [];

    // Resolve trace-level agent colors
    const traceAgentName = (data as any)?.agent?.name || 'Agent';
    const traceModel = (data as any)?.agent?.model || steps.find(s => s.model)?.model;
    const agentColor = steps.find(s => s.color)?.color || getAgentColor(traceAgentName, traceModel);
    const darkerAgentColor = steps.find(s => s.darkerColor)?.darkerColor || getDarkerAgentColor(traceAgentName, traceModel);
    trace.agentColor = agentColor;
    trace.darkerAgentColor = darkerAgentColor;

    // Find start time and duration/tokens for this specific trace
    let startTime = 0;
    let traceDuration = 0;
    if (yAxisMode === 'time') {
      const timestamps: number[] = [];
      steps.forEach((s: ReasoningTraceStep) => {
        if (s.timestamp) timestamps.push(new Date(s.timestamp).getTime());
        if (s.completedAt) timestamps.push(new Date(s.completedAt).getTime());
      });
      if (timestamps.length > 0) {
        startTime = Math.min(...timestamps);
        traceDuration = Math.max(...timestamps) - startTime;
      }
    } else if (yAxisMode === 'tokens') {
      startTime = 0;
      let runningSum = 0;
      steps.forEach((s: ReasoningTraceStep) => {
        runningSum += getStepTokens(s.token_usage, selectedTokenTypes);
      });
      traceDuration = runningSum;
    }

    let traceScale = scale;
    if (stretch) {
      traceScale = traceDuration > 0 ? targetSpan / traceDuration : scale;
    }

    let cumulativeTokens = 0;
    const traceNodes: VisNode[] = [];
    let traceMaxX = 20;
    let maxUserX = 0;
    let maxAgentX = 0;
    let maxToolsX = 0;

    const updateMaxHeights = (nodeRight: number, column: string) => {
      if (nodeRight > traceMaxX) traceMaxX = nodeRight;
      if (nodeRight > maxContentWidth) maxContentWidth = nodeRight;
      if (column === 'user' && nodeRight > maxUserX) maxUserX = nodeRight;
      if (column === 'agent' && nodeRight > maxAgentX) maxAgentX = nodeRight;
      if (column === 'tools' && nodeRight > maxToolsX) maxToolsX = nodeRight;
    };

    steps.forEach((step: ReasoningTraceStep, index: number) => {
      const numNodes = step.nodes.length;

      const stepAgentColor = step.color || getAgentColor(step.agentName || traceAgentName, step.model || traceModel);
      const stepDarkerAgentColor = step.darkerColor || getDarkerAgentColor(step.agentName || traceAgentName, step.model || traceModel);

      let currentTs = step.timestamp ? new Date(step.timestamp).getTime() : NaN;
      let completedTs = step.completedAt ? new Date(step.completedAt).getTime() : NaN;

      if (isNaN(completedTs) && index < steps.length - 1) {
        const nextStep = steps[index + 1];
        completedTs = nextStep.timestamp ? new Date(nextStep.timestamp).getTime() : NaN;
      }

      let stepDuration = 0;
      if (!isNaN(currentTs) && !isNaN(completedTs)) {
        stepDuration = completedTs - currentTs;
      }

      const stepTokens = getStepTokens(step.token_usage, selectedTokenTypes);

      if (yAxisMode === 'tokens') {
        currentTs = cumulativeTokens;
        stepDuration = stepTokens;
        completedTs = cumulativeTokens + stepTokens;
      }

      let stepNodeHeight = nodeW;
      if (stepDuration > 0) {
        stepNodeHeight = Math.max(12, (stepDuration * traceScale) / numNodes);
      }

      const ctx: NodeBuildContext = {
        cols,
        rows: cols,
        yAxisMode,
        traceScale,
        startTime,
        stepAgentColor,
        stepDarkerAgentColor,
        traceId: id,
        nodeW,
        step,
        numNodes,
        stepDuration,
        currentTs,
        completedTs,
        stepNodeHeight,
      };

      step.nodes.forEach((an: ReasoningTraceNode, nodeIndex: number) => {
        if (an.text === "Our servers are experiencing high traffic right now, please try again in a minute." ||
          an.text === "Encountered retryable error from model provider: Our servers are experiencing high traffic right now, please try again in a minute.") {
          if (traceNodes.length > 0) {
            (traceNodes[traceNodes.length - 1] as any).followedByRateLimit = true;
          }
          const result = buildRateLimitNode(ctx, currentY, an, xOffset, gap);
          traceNodes.push(result.node);
          currentY = result.nextY;
        } else {
          let col = an.column;
          if (an.type === TraceNodeType.SYSTEM || an.type === TraceNodeType.TOOL_CALL) {
            col = TraceNodeColumn.AGENT;
          }
          const nodeGap = nodeIndex > 0 ? 0 : gap;

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
          updateMaxHeights(result.nodeBottom, result.column);
        }
      });

      if (yAxisMode === 'tokens') {
        cumulativeTokens += stepTokens;
      }
    });

    const { waitingRects: compressedRects, gapsToReduce, traceMaxX: newTraceMaxX } = compressGaps({
      traceNodes,
      yAxisMode,
      scale: traceScale,
      baseScale,
      hideGaps,
      traceMaxX,
    });
    traceMaxX = newTraceMaxX;
    waitingRects.push(...compressedRects);

    rebuildConnectionLines(traceNodes, cols, nodeW, yAxisMode, startTime, traceScale, gapsToReduce);

    const cx = cols.agent.center;

    // Generate area charts as ThinkingAreaNodes
    const sortedNodes = [...traceNodes].filter(n => !n.hidden).sort((a, b) => a.x - b.x);
    const traceThinkingAreaNodes = buildThinkingAreaNodes(id, sortedNodes, cx, yAxisMode);
    const traceBackboneLines = buildBackboneLines(id, cx, waitingRects, traceMaxX, agentColor, sortedNodes);

    trace.nodes = traceNodes;
    trace.thinkingAreaNodes = traceThinkingAreaNodes;
    trace.backboneLines = traceBackboneLines;
    trace.maxTraceX = traceMaxX + 20;
    trace.maxTraceY = 140;

    allNodes.push(...traceThinkingAreaNodes);
    allNodes.push(...traceNodes);
    backboneLines.push(...traceBackboneLines);
  });

  // Normalize node widths/heights to match actual visual dimensions for icons
  allNodes.forEach(n => {
    if (n.hidden) return;
    const vc = getNodeVisualConfig(n);
    if (['diff', 'view', 'search'].includes(vc.type)) {
      n.width = 16;
      n.height = 16;
    }
  });

  let contentWidth = 500;
  let maxContentHeight = 140;
  const layoutRes = applyRowLayout({
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
  contentWidth = layoutRes.contentWidth;
  maxContentHeight = layoutRes.maxContentHeight;

  return {
    nodes: allNodes,
    backboneLines,
    contentWidth,
    contentHeight: maxContentHeight + 100,
    timeTicks,
    timeUnitLabel: intervalLabel,
  };
}
