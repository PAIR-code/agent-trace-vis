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
 * - User Input Nodes (the left-most nodes representing user prompt steps)
 * - Response Nodes (nodes showing when the agent responds back to the user)
 * - Thinking Nodes (nodes representing model reasoning steps, often centered and expanded)
 * - Thinking Area Shapes (the large custom-shaped backgrounds representing model thinking durations)
 * - Tool Call / Tool Data Nodes (representing calls to file actions, search, or terminal commands)
 * - Error & Rate Limit Indicators (rate limits are drawn as dashed lines across all columns)
 * - Connection Lines (curves connecting tool nodes back to the agent backbone)
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
  const { traceScale, startTime, stepAgentColor, cols, numNodes, stepDuration, currentTs, completedTs, stepNodeHeight } = ctx;

  const width = 40;
  const height = stepNodeHeight;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const y_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const y = y_end - height;

  // Compute step-level y positions for the thinking area block.
  // The area block should span the full step duration, not just this node's 1/N fraction.
  const timeBasedY = !isNaN(currentTs) ? BASE_OFFSET + (currentTs - startTime) * traceScale : y;
  const timeBasedEndY = !isNaN(completedTs) ? BASE_OFFSET + (completedTs - startTime) * traceScale : y + height;

  const x = cols.agent.center;

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
    timeBasedY,
    timeBasedEndY,
    color: stepAgentColor,
    stepType: an.stepType
  };

  const nextY = currentY + height + nodeGap;
  return { node, nextY, nodeBottom: y + height, column: 'agent' };
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
  const { traceScale, startTime, stepDarkerAgentColor, stepAgentColor, cols, nodeW, numNodes, stepDuration, currentTs } = ctx;
  const segmentHeight = nodeW;
  const width = nodeW;
  const height = segmentHeight;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const y_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const y = y_end - height;

  const x = cols[column].center - width / 2 + 12;
  const targetY = y + height;
  const targetX = x + nodeW;
  const sx = cols.agent.center;
  const midX = (sx + targetX) / 2;
  const path = `M ${sx} ${targetY} C ${midX} ${targetY}, ${midX} ${targetY}, ${targetX} ${targetY}`;

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

  const nextY = currentY + height + nodeGap;
  return { node, nextY, nodeBottom: y + height, column };
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
  const { traceScale, startTime, stepAgentColor, cols, nodeW, numNodes, stepDuration, currentTs, stepNodeHeight } = ctx;
  const segmentHeight = (type === TraceNodeType.USER_INPUT || type === TraceNodeType.SYSTEM || type === TraceNodeType.ERROR)
    ? nodeW
    : stepNodeHeight;
  const width = nodeW;
  const height = (type === TraceNodeType.SYSTEM || type === TraceNodeType.TOOL_DATA) ? width : segmentHeight;

  const t_end = !isNaN(currentTs) ? currentTs + ((nodeIndex + 1) / numNodes) * stepDuration : currentTs;
  const y_end = !isNaN(t_end) ? BASE_OFFSET + (t_end - startTime) * traceScale : currentY;
  const y = y_end - height;

  let x = cols[column].center - width / 2;

  if (column === 'tools') {
    const visualConfig = getNodeVisualConfig(an);
    if (visualConfig.shouldShift) {
      x += width;
    }
  }

  const nx = x + nodeW / 2;
  const ny = y + height / 2;
  const tx = cols.agent.center;

  let connectionLine: ConnectionLine | undefined = undefined;
  let returnConnectionLine: ConnectionLine | undefined = undefined;

  if (type === TraceNodeType.SYSTEM) {
    if (nx !== tx) {
      const midX = (nx + tx) / 2;
      const path = `M ${nx} ${ny} C ${midX} ${ny}, ${midX} ${ny}, ${tx} ${ny}`;
      connectionLine = {
        id: `${nid}_to_backbone`,
        path,
        stroke: LINE_COLOR,
        fill: 'none',
        strokeWidth: 1.5,
        opacity: 0.7,
      };
    }
  } else if (type === TraceNodeType.TOOL_CALL) {
    const sx = cols.agent.center;
    if (nx !== sx) {
      const midX = (sx + nx) / 2;
      const path = `M ${sx} ${ny} C ${midX} ${ny}, ${midX} ${ny}, ${nx} ${ny}`;
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

    const callPath = `M ${tx} ${y} C ${nx} ${y}, ${nx} ${y + (ny - y) * 0.5}, ${nx} ${ny}`;
    const returnPath = `M ${nx} ${ny} L ${tx} ${ny}`;
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

  const nextY = currentY + height + nodeGap;
  return { node: nodeResult, nextY, nodeBottom: y + height, column };
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
  const y = !isNaN(t) ? BASE_OFFSET + (t - startTime) * traceScale : currentY;
  const lineY = y;
  const path = `M ${xOffset} ${lineY} L ${xOffset + 140} ${lineY}`;

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
  cx: number,
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
    // timeBasedY = step start, timeBasedEndY = step end.
    // This ensures the block spans the full step duration.
    const minY = Math.min(...block.map(n => n.timeBasedY));
    const maxY = Math.max(...block.map(n => n.timeBasedEndY));
    const blockHeight = Math.max(1, maxY - minY);

    let blockWidth: number;
    if (yAxisMode === 'tokens') {
      blockWidth = CONSTANT_WIDTH;
    } else {
      // Proportional to output_tokens, normalized against max across all blocks
      blockWidth = MIN_BLOCK_WIDTH +
        (MAX_BLOCK_WIDTH - MIN_BLOCK_WIDTH) * (blockTokens[blockIndex] / maxTokens);
    }

    // Clamp corner radius to avoid degenerate paths
    const r = Math.min(CORNER_RADIUS, blockWidth, blockHeight / 2);

    // Rectangular path with rounded corners on the right side only (away from
    // backbone at cx). After the x↔y swap in row layout, these become the
    // bottom corners — the edge away from the horizontal backbone.
    const path = [
      `M ${cx} ${minY}`,
      `L ${cx + blockWidth - r} ${minY}`,
      `Q ${cx + blockWidth} ${minY} ${cx + blockWidth} ${minY + r}`,
      `L ${cx + blockWidth} ${maxY - r}`,
      `Q ${cx + blockWidth} ${maxY} ${cx + blockWidth - r} ${maxY}`,
      `L ${cx} ${maxY}`,
      'Z'
    ].join(' ');

    result.push({
      id: `${traceId}_area_chart_${blockIndex}`,
      traceId,
      type: TraceNodeType.THINKING_AREA,
      x: cx,
      y: minY,
      width: blockWidth,
      height: blockHeight,
      label: '',
      text: '',
      data: null,
      color: null,
      path: path,
      fill: `url(#grad-${sanitizeId(traceId)})`,
      stroke: '#e2e8f0',
      strokeWidth: 1,
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
  gapsToReduce: { originalY: number; originalHeight: number; shift: number }[]
): void {
  traceNodes.forEach(n => {
    if (n.hidden || isFileEventNode(n) || n.type === TraceNodeType.USER_INPUT || n.type === TraceNodeType.THINKING || !n.connectionLine) {
      return;
    }
    const nx = n.x + nodeW / 2;
    const ny = n.y + n.height / 2;
    const tx = cols.agent.center;

    if (n.type === TraceNodeType.RESPONSE) {
      const sx = cols.agent.center;
      const targetY = n.y + n.height;
      const targetX = n.x + nodeW;
      const midX = (sx + targetX) / 2;
      n.connectionLine.path = `M ${sx} ${targetY} C ${midX} ${targetY}, ${midX} ${targetY}, ${targetX} ${targetY}`;
    } else if (n.type === TraceNodeType.SYSTEM) {
      if (nx !== tx) {
        const midX = (nx + tx) / 2;
        n.connectionLine.path = `M ${nx} ${ny} C ${midX} ${ny}, ${midX} ${ny}, ${tx} ${ny}`;
      }
    } else if (n.type === TraceNodeType.TOOL_CALL) {
      const sx = cols.agent.center;
      if (nx !== sx) {
        const midX = (sx + nx) / 2;
        n.connectionLine.path = `M ${sx} ${ny} C ${midX} ${ny}, ${midX} ${ny}, ${nx} ${ny}`;
      }
    } else if (n.type === TraceNodeType.TOOL_DATA) {
      if (yAxisMode === 'time') {
        // Re-evaluate shifted currentTs Y position
        const currentTs = n.timestamp ? new Date(n.timestamp).getTime() : NaN;
        const y_start_original = !isNaN(currentTs) ? BASE_OFFSET + (currentTs - startTime) * traceScale : n.y;
        let shift = 0;
        gapsToReduce.forEach(gap => {
          if (y_start_original >= gap.originalY + gap.originalHeight) {
            shift += gap.shift;
          }
        });
        const y_start = y_start_original - shift;
        n.connectionLine.path = `M ${tx} ${y_start} C ${nx} ${y_start}, ${nx} ${y_start + (ny - y_start) * 0.5}, ${nx} ${ny}`;
        if (n.returnConnectionLine) {
          n.returnConnectionLine.path = `M ${nx} ${ny} L ${tx} ${ny}`;
        }
      } else {
        const midX = (nx + tx) / 2;
        n.connectionLine.path = `M ${nx} ${ny} C ${midX} ${ny}, ${midX} ${ny}, ${tx} ${ny}`;
      }
    }
  });
}
