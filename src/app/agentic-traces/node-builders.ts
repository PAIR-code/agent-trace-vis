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
 * @fileoverview Construction logic for individual visual components (nodes) and their connections.
 * 
 * Functions here build:
 * - User Input Nodes (the top-most nodes in row layout representing user prompt steps)
 * - Response Nodes (nodes showing when the agent responds back to the user)
 * - Thinking Nodes (nodes representing model reasoning steps, centered and expanded along row)
 * - Thinking Area Shapes (the large custom-shaped backgrounds representing model thinking durations)
 * - Tool Call / Tool Data Nodes (representing calls to file actions, search, or terminal commands)
 * - Error & Rate Limit Indicators (rate limits are drawn as dashed lines across all rows)
 * - Connection Lines (lines connecting tool nodes back to the agent backbone)
 */

import { TraceNodeType, TraceNodeColumn, ReasoningTraceNode, ReasoningTraceStep, BASE_OFFSET } from './layout-types';
import { getNodeVisualConfig, isFileEventNode } from './node-rendering-helper';
import { lightenColor, LINE_COLOR, COLORS } from './colors';
import {
  ConnectionLine, ErrorNode, InteractiveNodeBase, ResponseNode,
  ThinkingAreaNode, ThinkingStepNode, ToolCallNode, ToolDataNode,
  UserInputNode, SystemNode, VisNode
} from './layout-types';
import { sanitizeId, calcHeight, truncate } from './layout-utils';

export interface NodeBuildContext {
  cols: { user: { center: number }; agent: { center: number }; tools: { center: number } };
  rows?: { user: { center: number }; agent: { center: number }; tools: { center: number } };
  yAxisMode: 'time' | 'tokens';
  traceScale: number;
  startTime: number;
  stepAgentColor: string;
  stepDarkerAgentColor: string;
  traceId: string;
  nodeW: number;
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
  const { traceScale, startTime, stepAgentColor, cols, rows, numNodes, stepDuration, currentTs, completedTs, stepNodeHeight } = ctx;
  const channelRows = rows || cols;

  const width = stepNodeHeight;
  const height = 40;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const x_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const x = x_end - width;

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
    data: ctx.step,
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
  const { traceScale, startTime, stepDarkerAgentColor, stepAgentColor, cols, rows, nodeW, numNodes, stepDuration, currentTs } = ctx;
  const channelRows = rows || cols;
  const segmentWidth = nodeW;
  const width = segmentWidth;
  const height = nodeW;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const x_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const x = x_end - width;

  const y = channelRows[column].center - height / 2 + 12;
  const targetX = x + width;
  const targetY = y + height;
  const sy = channelRows.agent.center;
  const midY = (sy + targetY) / 2;
  const path = `M ${targetX} ${sy} C ${targetX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;

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
    data: ctx.step,
    traceId: ctx.traceId,
    timestamp: an.timestamp,
    color: stepDarkerAgentColor,
    connectionLine: {
      id: `${nid}_from_agent_backbone`,
      path,
      stroke: stepAgentColor,
      fill: 'none',
      strokeWidth: 1.5,
      opacity: 0.7,
    },
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
  const { traceScale, startTime, stepAgentColor, cols, rows, nodeW, numNodes, stepDuration, currentTs, stepNodeHeight } = ctx;
  const channelRows = rows || cols;
  const segmentWidth = (type === TraceNodeType.USER_INPUT || type === TraceNodeType.SYSTEM || type === TraceNodeType.ERROR)
    ? nodeW
    : stepNodeHeight;
  const height = nodeW;
  const width = (type === TraceNodeType.SYSTEM || type === TraceNodeType.TOOL_DATA) ? height : segmentWidth;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const x_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const x = x_end - width;

  let y = channelRows[column].center - height / 2;

  if (column === 'tools') {
    const visualConfig = getNodeVisualConfig(an);
    if (visualConfig.shouldShift) {
      y += height;
    }
  }

  const nx = x + width / 2;
  const ny = y + height / 2;
  const ty = channelRows.agent.center;

  let connectionLine: ConnectionLine | undefined = undefined;
  let returnConnectionLine: ConnectionLine | undefined = undefined;

  if (type === TraceNodeType.SYSTEM) {
    if (ny !== ty) {
      const midY = (ny + ty) / 2;
      const path = `M ${nx} ${ny} C ${nx} ${midY}, ${nx} ${midY}, ${nx} ${ty}`;
      connectionLine = {
        id: `${nid}_to_backbone`,
        path,
        stroke: stepAgentColor,
        fill: 'none',
        strokeWidth: 1.5,
        opacity: 0.7,
      };
    }
  } else if (type === TraceNodeType.TOOL_CALL) {
    const sy = channelRows.agent.center;
    if (ny !== sy) {
      const midY = (sy + ny) / 2;
      const path = `M ${nx} ${sy} C ${nx} ${midY}, ${nx} ${midY}, ${nx} ${ny}`;
      connectionLine = {
        id: `${nid}_from_agent_to_tool`,
        path,
        stroke: stepAgentColor,
        fill: 'none',
        strokeWidth: 1.5,
        opacity: 0.7,
      };
    }
  } else if (type === TraceNodeType.TOOL_DATA) {
    const isFailed = !!an.data?.observation?.error;
    const stroke = isFailed ? COLORS.ERROR : lightenColor(stepAgentColor, 0.3);

    const callPath = `M ${x} ${ty} C ${x} ${ny}, ${x + (nx - x) * 0.5} ${ny}, ${nx} ${ny}`;
    const returnPath = `M ${nx} ${ny} L ${nx} ${ty}`;
    const normalStroke = lightenColor(stepAgentColor, 0.3);
    const returnStroke = isFailed ? COLORS.ERROR : normalStroke;
    const returnOpacity = isFailed ? 0.7 : 0.35;

    connectionLine = {
      id: `${nid}_tool_call_path`,
      path: callPath,
      stroke: normalStroke,
      fill: 'none',
      strokeWidth: 1.5,
      opacity: 0.35,
    };

    returnConnectionLine = {
      id: `${nid}_tool_return_path`,
      path: returnPath,
      stroke: returnStroke,
      fill: 'none',
      strokeWidth: 1.5,
      opacity: returnOpacity,
    };
  }

  const isFile = isFileEventNode(an);
  if (isFile) {
    connectionLine = undefined;
    returnConnectionLine = undefined;
  }

  const baseNode: InteractiveNodeBase = {
    id: nid,
    type,
    x,
    y,
    width,
    height,
    label: truncate(text, 80),
    text,
    data: ctx.step,
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
    nodeResult = { ...baseNode, type: TraceNodeType.TOOL_CALL, column: 'agent', connectionLine } as ToolCallNode;
  } else if (type === TraceNodeType.TOOL_DATA) {
    nodeResult = { ...baseNode, type: TraceNodeType.TOOL_DATA, column: 'tools', connectionLine, returnConnectionLine } as ToolDataNode;
  } else if (type === TraceNodeType.SYSTEM) {
    nodeResult = { ...baseNode, type: TraceNodeType.SYSTEM, column: 'agent', connectionLine } as SystemNode;
  } else if (type === TraceNodeType.ERROR) {
    nodeResult = { ...baseNode, type: TraceNodeType.ERROR, column: 'agent', connectionLine } as ErrorNode;
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
  an: ReasoningTraceNode,
  xOffset: number,
  gap: number,
): RateLimitResult {
  const { traceScale, startTime, currentTs, completedTs } = ctx;
  const t = !isNaN(completedTs) ? completedTs : currentTs;
  const x = !isNaN(t) ? BASE_OFFSET + (t - startTime) * traceScale : currentY;
  const lineX = x;
  const path = `M ${lineX} ${xOffset} L ${lineX} ${xOffset + 140}`;

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
    connectionLine: {
      id: `${an.id}_special_error`,
      path,
      stroke: COLORS.ERROR,
      fill: 'none',
      strokeWidth: 2,
      opacity: 0.3,
    },
    stepType: an.stepType
  };

  const nextY = currentY;

  return { node: hiddenNode, nextY };
}

export function buildThinkingAreaNodes(
  traceId: string,
  sortedNodes: VisNode[],
  cy: number,
  yAxisMode: 'time' | 'tokens' = 'time'
): ThinkingAreaNode[] {
  // Find contiguous blocks of thinking nodes
  const thinkingBlocks: ThinkingStepNode[][] = [];
  let currentBlock: ThinkingStepNode[] = [];

  sortedNodes.forEach(n => {
    if (n.type === TraceNodeType.THINKING) {
      currentBlock.push(n as ThinkingStepNode);
    } else {
      if (currentBlock.length > 0) {
        thinkingBlocks.push(currentBlock);
        currentBlock = [];
      }
    }
  });
  if (currentBlock.length > 0) {
    thinkingBlocks.push(currentBlock);
  }

  // Compute output tokens per block for proportional sizing
  const blockTokens: number[] = thinkingBlocks.map(block => {
    const uniqueSteps = new Set<any>();
    block.forEach(n => {
      if (n.data) uniqueSteps.add(n.data);
    });
    let totalTokens = 0;
    uniqueSteps.forEach(step => {
      totalTokens += step.token_usage?.output_tokens || 0;
    });
    // Fallback to word count if no token data available
    if (totalTokens === 0) {
      totalTokens = block.reduce(
        (sum, n) => sum + n.text.split(/\s+/).filter((w: string) => w.length > 0).length,
        0
      );
    }
    return totalTokens;
  });

  const maxTokens = Math.max(...blockTokens, 1);
  const MAX_BLOCK_WIDTH = 40;
  const MIN_BLOCK_WIDTH = 8;
  const CONSTANT_WIDTH = 30; // Used in tokens mode
  const CORNER_RADIUS = 3;

  const result: ThinkingAreaNode[] = [];

  // Generate rectangular blocks as ThinkingAreaNodes
  thinkingBlocks.forEach((block, blockIndex) => {
    if (block.length === 0) return;

    // Use step-level time positions for block bounds.
    const minX = Math.min(...block.map(n => (n as any).timeBasedX ?? n.x));
    const maxX = Math.max(...block.map(n => (n as any).timeBasedEndX ?? n.x + n.width));
    const blockWidth = Math.max(1, maxX - minX);

    let blockHeight: number;
    if (yAxisMode === 'tokens') {
      blockHeight = CONSTANT_WIDTH;
    } else {
      // Proportional to output_tokens, normalized against max across all blocks
      blockHeight = MIN_BLOCK_WIDTH +
        (MAX_BLOCK_WIDTH - MIN_BLOCK_WIDTH) * (blockTokens[blockIndex] / maxTokens);
    }

    // Clamp corner radius to avoid degenerate paths
    const r = Math.min(CORNER_RADIUS, blockHeight, blockWidth / 2);

    // Rectangular path with rounded corners on the bottom side only (away from
    // backbone at cy=70).
    const path = [
      `M ${minX} ${cy}`,
      `L ${minX} ${cy + blockHeight - r}`,
      `Q ${minX} ${cy + blockHeight} ${minX + r} ${cy + blockHeight}`,
      `L ${maxX - r} ${cy + blockHeight}`,
      `Q ${maxX} ${cy + blockHeight} ${maxX} ${cy + blockHeight - r}`,
      `L ${maxX} ${cy}`,
      'Z'
    ].join(' ');

    const blockColor = (block[0] as any).color || (block[0].data as ReasoningTraceStep)?.color || COLORS.AGENT;

    result.push({
      id: `${traceId}_area_chart_${blockIndex}`,
      traceId,
      type: TraceNodeType.THINKING_AREA,
      x: minX,
      y: cy,
      width: blockWidth,
      height: blockHeight,
      label: '',
      text: '',
      data: null,
      color: blockColor,
      path: path,
      fill: blockColor,
      stroke: 'none',
      strokeWidth: 0,
      opacity: 1
    });
  });

  return result;
}

export function rebuildConnectionLines(
  traceNodes: VisNode[],
  cols: { user: { center: number }; agent: { center: number }; tools: { center: number } },
  nodeW: number,
  yAxisMode: string,
  startTime: number,
  traceScale: number,
  gapsToReduce: { originalY?: number; originalX?: number; originalHeight?: number; originalWidth?: number; shift: number }[]
): void {
  traceNodes.forEach(n => {
    if (n.hidden || isFileEventNode(n) || n.type === TraceNodeType.USER_INPUT || n.type === TraceNodeType.THINKING || !n.connectionLine) {
      return;
    }
    const nx = n.x + n.width / 2;
    const ny = n.y + n.height / 2;
    const ty = cols.agent.center;

    if (n.type === TraceNodeType.RESPONSE) {
      const sy = cols.agent.center;
      const targetX = n.x + n.width;
      const targetY = n.y + n.height;
      const midY = (sy + targetY) / 2;
      n.connectionLine.path = `M ${targetX} ${sy} C ${targetX} ${midY}, ${targetX} ${midY}, ${targetX} ${targetY}`;
    } else if (n.type === TraceNodeType.SYSTEM) {
      if (ny !== ty) {
        const midY = (ny + ty) / 2;
        n.connectionLine.path = `M ${nx} ${ny} C ${nx} ${midY}, ${nx} ${midY}, ${nx} ${ty}`;
      }
    } else if (n.type === TraceNodeType.TOOL_CALL) {
      const sy = cols.agent.center;
      if (ny !== sy) {
        const midY = (sy + ny) / 2;
        n.connectionLine.path = `M ${nx} ${sy} C ${nx} ${midY}, ${nx} ${midY}, ${nx} ${ny}`;
      }
    } else if (n.type === TraceNodeType.TOOL_DATA) {
      if (yAxisMode === 'time') {
        // Re-evaluate shifted currentTs X position
        const currentTs = n.timestamp ? new Date(n.timestamp).getTime() : NaN;
        const x_start_original = !isNaN(currentTs) ? BASE_OFFSET + (currentTs - startTime) * traceScale : n.x;
        let shift = 0;
        gapsToReduce.forEach(gap => {
          const origPos = gap.originalX ?? gap.originalY ?? 0;
          const origSpan = gap.originalWidth ?? gap.originalHeight ?? 0;
          if (x_start_original >= origPos + origSpan) {
            shift += gap.shift;
          }
        });
        const x_start = x_start_original - shift;
        n.connectionLine.path = `M ${x_start} ${ty} C ${x_start} ${ny}, ${x_start + (nx - x_start) * 0.5} ${ny}, ${nx} ${ny}`;
        if (n.returnConnectionLine) {
          n.returnConnectionLine.path = `M ${nx} ${ny} L ${nx} ${ty}`;
        }
      } else {
        const midY = (ny + ty) / 2;
        n.connectionLine.path = `M ${nx} ${ny} C ${nx} ${midY}, ${nx} ${midY}, ${nx} ${ty}`;
      }
    }
  });
}
