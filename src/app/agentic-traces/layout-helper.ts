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
 * @fileoverview Top-level layout orchestrator — computes node positions,
 * backbone lines, and SVG dimensions for the trace visualization.
 */

import { TraceNodeType, TraceNodeColumn, ModelFamily, ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, BASE_OFFSET } from './layout-types';
import { getModelColor, getDarkerModelColor, COLORS } from './colors';
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
  const { traces, selectedTraceIds, yAxisMode, layoutMode, hideGaps, selectedTokenTypes } = params;

  const allNodes: VisNode[] = [];
  const backboneLines: BackboneLine[] = [];
  const nodeW = 12;
  const gap = yAxisMode === 'default' ? 2 : 12; // vertical gap between nodes
  let maxContentHeight = 1000;

  const idsArray = [...selectedTraceIds];

  const timeAxis = computeTimeAxis(traces, selectedTraceIds, yAxisMode, hideGaps, selectedTokenTypes);
  const { scale, baseScale, timeTicks, intervalLabel } = timeAxis;

  idsArray.forEach((id, traceIndex) => {
    const trace = traces.find(t => t.id === id);
    if (!trace || !trace.data) return;

    const data = trace.data;
    const waitingRects: any[] = [];
    const rowTitlePad = layoutMode === 'row' ? 18 : 0;
    const axisWidth = (yAxisMode === 'time' || yAxisMode === 'tokens') ? 60 : 0;
    const xOffset = axisWidth + rowTitlePad + traceIndex * 160;
    const traceSpecialErrorLines: any[] = [];

    const cols = {
      user: { center: xOffset + 23.33 },
      agent: { center: xOffset + 70 },
      tools: { center: xOffset + 116.66 },
    };

    let currentY = BASE_OFFSET;
    const steps = (data as ReasoningTrace).steps || [];
    const rawStops: { y: number, color: string }[] = [];

    // Find a model family in the steps to assign trace colors
    let traceModelFamily = ModelFamily.UNKNOWN;
    for (const step of steps) {
      if (step.modelFamily) {
        traceModelFamily = step.modelFamily;
        break;
      }
    }
    const agentColor = getModelColor(traceModelFamily);
    const darkerAgentColor = getDarkerModelColor(traceModelFamily);
    trace.agentColor = agentColor;
    trace.darkerAgentColor = darkerAgentColor;

    // Find start time for this trace
    const firstStepWithTime = steps.find((s: ReasoningTraceStep) => s.timestamp);
    let startTime = firstStepWithTime?.timestamp ? new Date(firstStepWithTime.timestamp).getTime() : 0;
    if (yAxisMode === 'tokens') {
      startTime = 0;
    }

    let cumulativeTokens = 0;

    const traceScale = scale;
    const traceNodes: VisNode[] = [];
    let traceMaxY = 20;
    let maxUserY = 0;
    let maxAgentY = 0;
    let maxToolsY = 0;

    const updateMaxHeights = (nodeBottom: number, column: string) => {
      if (nodeBottom > traceMaxY) traceMaxY = nodeBottom;
      if (nodeBottom > maxContentHeight) maxContentHeight = nodeBottom;
      if (column === 'user' && nodeBottom > maxUserY) maxUserY = nodeBottom;
      if (column === 'agent' && nodeBottom > maxAgentY) maxAgentY = nodeBottom;
      if (column === 'tools' && nodeBottom > maxToolsY) maxToolsY = nodeBottom;
    };

    steps.forEach((step: ReasoningTraceStep, index: number) => {
      const numNodes = step.nodes.length;

      const stepModel = step.modelFamily || traceModelFamily;
      const stepAgentColor = getModelColor(stepModel);
      const stepDarkerAgentColor = getDarkerModelColor(stepModel);

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
      if ((yAxisMode === 'time' || yAxisMode === 'tokens') && stepDuration > 0) {
        stepNodeHeight = Math.max(12, (stepDuration * traceScale) / numNodes);
      }

      const ctx: NodeBuildContext = {
        cols,
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

      const stepNodes = traceNodes.filter(n => n.data === step);
      if (stepNodes.length > 0) {
        const minY = Math.min(...stepNodes.map(n => n.y));
        if (step.modelFamily) {
          const color = getModelColor(step.modelFamily);
          rawStops.push({ y: minY, color: color });
        }
      }

      if (yAxisMode === 'tokens') {
        cumulativeTokens += stepTokens;
      }
    });

    const { waitingRects: compressedRects, gapsToReduce, traceMaxY: newTraceMaxY } = compressGaps({
      traceNodes,
      yAxisMode,
      scale,
      baseScale,
      hideGaps,
      traceMaxY,
    });
    traceMaxY = newTraceMaxY;
    waitingRects.push(...compressedRects);

    // Since we shifted connection lines, we need to rebuild them if shifts happened.
    // However, it's easier to just shift their coordinates or rebuild them after shift.
    // Let's re-align connection lines based on shifted nodes.
    rebuildConnectionLines(traceNodes, cols, nodeW, yAxisMode, startTime, traceScale, gapsToReduce);

    // Calculate gradient stops
    const gradientStops: { offset: string, color: string }[] = [];
    let prevColor = '';
    rawStops.forEach(rs => {
      const offset = `${rs.y / (maxContentHeight + 100)}`;
      if (rs.color !== prevColor) {
        if (prevColor) {
          gradientStops.push({ offset: offset, color: prevColor });
        }
        gradientStops.push({ offset: offset, color: rs.color });
        prevColor = rs.color;
      }
    });
    if (gradientStops.length > 0) {
      gradientStops.push({ offset: '1', color: prevColor });
    } else {
      gradientStops.push({ offset: '0', color: COLORS.AGENT });
      gradientStops.push({ offset: '1', color: COLORS.AGENT });
    }
    trace.gradientStops = gradientStops;

    const cx = cols.agent.center;

    // Generate area charts as ThinkingAreaNodes
    const sortedNodes = [...traceNodes].filter(n => !n.hidden).sort((a, b) => a.y - b.y);
    allNodes.push(...buildThinkingAreaNodes(id, sortedNodes, cx));

    // Add agent backbone line segments
    backboneLines.push(...buildBackboneLines(id, cx, waitingRects, traceMaxY));

    trace.maxTraceY = traceMaxY + 20;
    allNodes.push(...traceNodes);
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
  const layoutRes = applyRowLayout({
    allNodes,
    backboneLines,
    timeTicks,
    yAxisMode,
    traces,
    selectedTraceIds,
    layoutMode,
    maxContentHeight
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
