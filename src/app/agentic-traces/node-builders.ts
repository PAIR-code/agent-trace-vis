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
 * @fileoverview Construction logic for individual visual components (nodes).
 * 
 * Functions here build:
 * - User Input Nodes (the top-most nodes in row layout representing user prompt steps)
 * - Response Nodes (nodes showing when the agent responds back to the user)
 * - Thinking Nodes (nodes representing model reasoning steps, centered and expanded along row)
 * - Thinking Area Shapes (the large custom-shaped backgrounds representing model thinking durations)
 * - Tool Call / Tool Data Nodes (representing calls to file actions, search, or terminal commands)
 * - Error & Rate Limit Indicators
 */

import { TraceNodeType, TraceNodeColumn, ReasoningTraceNode, ReasoningTraceStep, BASE_OFFSET } from './layout-types';
import { getNodeVisualConfig, isFileEventNode } from './node-rendering-helper';
import { COLORS } from './colors';
import {
  ErrorNode, InteractiveNodeBase, ResponseNode,
  ThinkingAreaNode, ThinkingStepNode, ToolCallNode, ToolDataNode,
  UserInputNode, SystemNode, VisNode
} from './layout-types';
import { truncate, getStepTokens } from './layout-utils';

export interface NodeBuildContext {
  cols: { user: { center: number }; agent: { center: number }; tools: { center: number } };
  rows?: { user: { center: number }; agent: { center: number }; tools: { center: number } };
  yAxisMode: 'time' | 'tokens';
  traceScale: number;
  startTime: number;
  stepAgentColor: string;
  traceId: string;
  nodeW: number;
  maxTokens?: number;
  selectedTokenTypes?: Set<string>;
  // step-level context
  step: ReasoningTraceStep;
  numNodes: number;
  stepDuration: number;
  currentTs: number;
  completedTs: number;
  stepNodeHeight: number;
}

export interface NodeBuildResult {
  node: VisNode;
  nextY: number;
  nodeBottom: number;
  column: string;
}

export function buildThinkingNode(
  ctx: NodeBuildContext,
  currentY: number,
  nid: string,
  text: string,
  nodeIndex: number,
  nodeGap: number,
  an: ReasoningTraceNode
): NodeBuildResult {
  const { traceScale, startTime, stepAgentColor, cols, rows, numNodes, stepDuration, currentTs, completedTs, stepNodeHeight, yAxisMode } = ctx;
  const channelRows = rows || cols;

  const width = stepNodeHeight;
  const height = 40;

  const nodeTs = an.timestamp ? new Date(an.timestamp).getTime() : currentTs;
  let x: number;
  if (yAxisMode === 'time' && !isNaN(nodeTs)) {
    x = BASE_OFFSET + (nodeTs - startTime) * traceScale;
  } else if (yAxisMode === 'tokens' && !isNaN(currentTs)) {
    x = BASE_OFFSET + (currentTs + (nodeIndex / Math.max(numNodes, 1)) * stepDuration) * traceScale;
  } else {
    x = currentY;
  }

  // Compute step-level x positions for the thinking area block.
  const timeBasedX = !isNaN(currentTs) ? BASE_OFFSET + (currentTs - startTime) * traceScale : x;
  const timeBasedEndX = !isNaN(completedTs) ? BASE_OFFSET + (completedTs - startTime) * traceScale : x + width;

  const y = channelRows.agent.center;

  const node: ThinkingStepNode = {
    id: nid,
    type: TraceNodeType.THINKING,
    column: 'agent',
    x,
    y,
    width,
    height,
    label: truncate(text, 80),
    text,
    data: an.data, stepRef: ctx.step,
    traceId: ctx.traceId,
    timestamp: an.timestamp,
    isWaiting: text.toLowerCase().includes('wait'),
    timeBasedY: y,
    timeBasedEndY: y + height,
    timeBasedX,
    timeBasedEndX,
    color: stepAgentColor,
    stepType: an.stepType
  } as any;

  const nextY = currentY + width + nodeGap;
  return { node, nextY, nodeBottom: x + width, column: 'agent' };
}

export function buildResponseNode(
  ctx: NodeBuildContext,
  currentY: number,
  nid: string,
  column: 'user',
  text: string,
  nodeIndex: number,
  nodeGap: number,
  an: ReasoningTraceNode
): NodeBuildResult {
  const { traceScale, startTime, stepAgentColor, cols, rows, numNodes, stepDuration, currentTs, yAxisMode, maxTokens } = ctx;
  const channelRows = rows || cols;
  const width = 7;

  const MAX_NODE_HEIGHT = 22;
  const MIN_NODE_HEIGHT = 10;
  const CONSTANT_NODE_HEIGHT = 18;

  let height: number;
  if (yAxisMode === 'tokens') {
    height = CONSTANT_NODE_HEIGHT;
  } else {
    let tokens = 0;
    if (ctx.step.token_usage) {
      tokens = getStepTokens(ctx.step.token_usage, ctx.selectedTokenTypes);
    } else {
      tokens = text.split(/\s+/).filter((w: string) => w.length > 0).length;
    }
    height = MIN_NODE_HEIGHT +
      (MAX_NODE_HEIGHT - MIN_NODE_HEIGHT) * (tokens / Math.max(maxTokens || 1, 1));
    height = Math.round(Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, height)));
  }

  const nodeTs = an.timestamp ? new Date(an.timestamp).getTime() : currentTs;
  let x: number;
  if (yAxisMode === 'time' && !isNaN(nodeTs)) {
    x = BASE_OFFSET + (nodeTs - startTime) * traceScale;
  } else if (yAxisMode === 'tokens' && !isNaN(currentTs)) {
    x = BASE_OFFSET + (currentTs + (nodeIndex / Math.max(numNodes, 1)) * stepDuration) * traceScale;
  } else {
    x = currentY;
  }

  // Agent text goes DOWN from the center line of the row
  const cy = channelRows[column].center;
  const y = cy + 1;

  const node: ResponseNode = {
    id: nid,
    type: TraceNodeType.RESPONSE,
    column,
    x,
    y,
    width,
    height,
    label: truncate(text, 80),
    text,
    data: an.data, stepRef: ctx.step,
    traceId: ctx.traceId,
    timestamp: an.timestamp,
    color: stepAgentColor,
    stepType: an.stepType
  };

  const nextY = currentY + width + nodeGap;
  return { node, nextY, nodeBottom: x + width, column };
}

export function buildDefaultNode(
  ctx: NodeBuildContext,
  currentY: number,
  nid: string,
  type: TraceNodeType,
  column: 'user' | 'agent' | 'tools',
  text: string,
  nodeIndex: number,
  nodeGap: number,
  an: ReasoningTraceNode
): NodeBuildResult {
  const { traceScale, startTime, stepAgentColor, cols, rows, nodeW, numNodes, stepDuration, currentTs, stepNodeHeight, yAxisMode, maxTokens } = ctx;
  const channelRows = rows || cols;
  const segmentWidth = (type === TraceNodeType.SYSTEM || type === TraceNodeType.ERROR)
    ? nodeW
    : stepNodeHeight;
  let height = nodeW;
  let width = (type === TraceNodeType.SYSTEM || type === TraceNodeType.TOOL_DATA) ? height : segmentWidth;

  if (type === TraceNodeType.USER_INPUT) {
    width = 7;
    const MAX_NODE_HEIGHT = 22;
    const MIN_NODE_HEIGHT = 10;
    const CONSTANT_NODE_HEIGHT = 18;

    if (yAxisMode === 'tokens') {
      height = CONSTANT_NODE_HEIGHT;
    } else {
      let tokens = 0;
      if (ctx.step.token_usage) {
        tokens = getStepTokens(ctx.step.token_usage, ctx.selectedTokenTypes);
      } else {
        tokens = text.split(/\s+/).filter((w: string) => w.length > 0).length;
      }
      height = MIN_NODE_HEIGHT +
        (MAX_NODE_HEIGHT - MIN_NODE_HEIGHT) * (tokens / Math.max(maxTokens || 1, 1));
      height = Math.round(Math.max(MIN_NODE_HEIGHT, Math.min(MAX_NODE_HEIGHT, height)));
    }
  }

  const nodeTs = an.timestamp ? new Date(an.timestamp).getTime() : currentTs;
  let x: number;
  if (yAxisMode === 'time' && !isNaN(nodeTs)) {
    x = BASE_OFFSET + (nodeTs - startTime) * traceScale;
  } else if (yAxisMode === 'tokens' && !isNaN(currentTs)) {
    x = BASE_OFFSET + (currentTs + (nodeIndex / Math.max(numNodes, 1)) * stepDuration) * traceScale;
  } else {
    x = currentY;
  }

  let y = channelRows[column].center - height / 2;
  if (type === TraceNodeType.USER_INPUT) {
    // User text goes UP from the center line of the row
    const cy = channelRows[column].center;
    y = cy - height - 1;
  }

  if (column === 'tools') {
    const visualConfig = getNodeVisualConfig(an);
    if (visualConfig.shouldShift) {
      y += height;
    }
  }

  const isFile = isFileEventNode(an);

  const baseNode: InteractiveNodeBase = {
    id: nid,
    type,
    x,
    y,
    width,
    height,
    label: truncate(text, 80),
    text,
    data: an.data, stepRef: ctx.step,
    traceId: ctx.traceId,
    timestamp: an.timestamp,
    color: null,
    borderColor: type === TraceNodeType.SYSTEM ? stepAgentColor : undefined,
    hidden: isFile || undefined,
    isFailed: (type === TraceNodeType.TOOL_DATA && !!an.data?.observation?.error) || undefined,
    stepType: an.stepType
  };

  let nodeResult: VisNode;
  if (type === TraceNodeType.USER_INPUT) {
    nodeResult = { ...baseNode, type: TraceNodeType.USER_INPUT, column: 'user' } as UserInputNode;
  } else if (type === TraceNodeType.TOOL_CALL) {
    nodeResult = { ...baseNode, type: TraceNodeType.TOOL_CALL, column: 'agent' } as ToolCallNode;
  } else if (type === TraceNodeType.TOOL_DATA) {
    nodeResult = { ...baseNode, type: TraceNodeType.TOOL_DATA, column: 'tools' } as ToolDataNode;
  } else if (type === TraceNodeType.SYSTEM) {
    nodeResult = { ...baseNode, type: TraceNodeType.SYSTEM, column: 'agent' } as SystemNode;
  } else if (type === TraceNodeType.ERROR) {
    nodeResult = { ...baseNode, type: TraceNodeType.ERROR, column: 'agent' } as ErrorNode;
  } else {
    nodeResult = { ...baseNode, type: type as any, column: 'tools' } as any;
  }

  const nextY = currentY + width + nodeGap;
  return { node: nodeResult, nextY, nodeBottom: x + width, column };
}

export interface RateLimitResult {
  node: ErrorNode;
  nextY: number;
}

export function buildRateLimitNode(
  ctx: NodeBuildContext,
  currentY: number,
  an: ReasoningTraceNode
): RateLimitResult {
  const hiddenNode: ErrorNode = {
    id: an.id,
    type: TraceNodeType.ERROR,
    column: 'agent',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    label: an.text,
    text: an.text,
    data: ctx.step,
    traceId: ctx.traceId,
    timestamp: an.timestamp,
    color: null,
    hidden: true,
    stepType: an.stepType
  };

  const nextY = currentY;

  return { node: hiddenNode, nextY };
}

export function buildThinkingAreaNodes(
  traceId: string,
  sortedNodes: VisNode[],
  cy: number,
  yAxisMode: 'time' | 'tokens' = 'time',
  selectedTokenTypes?: Set<string>
): ThinkingAreaNode[] {
  // Each thinking node renders as its own individual reasoning rectangle
  const thinkingNodes: ThinkingStepNode[] = sortedNodes.filter(
    n => n.type === TraceNodeType.THINKING
  ) as ThinkingStepNode[];

  if (thinkingNodes.length === 0) return [];

  // Compute tokens per thinking node for proportional sizing based on selected token types
  const nodeTokens: number[] = thinkingNodes.map(n => {
    const step = (n as any).stepRef as ReasoningTraceStep | undefined;
    if (step && step.token_usage) {
      return getStepTokens(step.token_usage, selectedTokenTypes);
    }
    // Fallback to word count
    return n.text ? n.text.split(/\s+/).filter((w: string) => w.length > 0).length : 0;
  });

  const maxTokens = Math.max(...nodeTokens, 1);
  const MAX_BLOCK_WIDTH = 40;
  const MIN_BLOCK_WIDTH = 8;
  const CONSTANT_WIDTH = 30; // Used in tokens mode
  const CORNER_RADIUS = 3;

  const result: ThinkingAreaNode[] = [];

  thinkingNodes.forEach((n, idx) => {
    const minX = (n as any).timeBasedX ?? n.x;
    const maxX = (n as any).timeBasedEndX ?? (n.x + n.width);
    const blockWidth = Math.max(1, maxX - minX);

    let blockHeight: number;
    if (yAxisMode === 'tokens') {
      blockHeight = CONSTANT_WIDTH;
    } else {
      // Proportional to selected tokens, normalized against max across all thinking steps
      blockHeight = MIN_BLOCK_WIDTH +
        (MAX_BLOCK_WIDTH - MIN_BLOCK_WIDTH) * (nodeTokens[idx] / maxTokens);
    }

    // Clamp corner radius to avoid degenerate paths
    const r = Math.min(CORNER_RADIUS, blockHeight, blockWidth / 2);

    // Rectangular path with rounded corners on the bottom side only (away from backbone)
    const path = [
      `M ${minX} ${cy}`,
      `L ${minX} ${cy + blockHeight - r}`,
      `Q ${minX} ${cy + blockHeight} ${minX + r} ${cy + blockHeight}`,
      `L ${maxX - r} ${cy + blockHeight}`,
      `Q ${maxX} ${cy + blockHeight} ${maxX} ${cy + blockHeight - r}`,
      `L ${maxX} ${cy}`,
      'Z'
    ].join(' ');

    const blockColor = (n as any).color || ((n as any).stepRef as ReasoningTraceStep)?.color || COLORS.AGENT;

    result.push({
      id: `${traceId}_area_chart_${idx}`,
      traceId,
      type: TraceNodeType.THINKING_AREA,
      x: minX,
      y: cy,
      width: blockWidth,
      height: blockHeight,
      label: '',
      text: n.text || '',
      data: n.data,
      color: blockColor,
      path: path,
      fill: blockColor,
      stroke: 'none',
      strokeWidth: 0,
      opacity: 0.65,
      nodeIds: [n.id]
    });
  });

  return result;
}
