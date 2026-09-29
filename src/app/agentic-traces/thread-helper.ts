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
 * @fileoverview Groups trace nodes into threaded messages for the conversation panel.
 *
 * Conversational grouping:
 * - User inputs and System checkpoints are standalone top-level cards.
 * - All consecutive agent actions (thinking, tools, responses) between user turns
 *   are grouped into a single Agent Turn parent card with aggregate stats.
 */

import { Mark } from './marks';
import { TraceNodeType, ReasoningTraceStep } from './layout-types';

export interface ThreadMessage {
  id: string;
  traceId: string;
  type: string;
  label: string;
  text: string;
  data: any;
  timestamp?: string;
  color?: string | null;
  children: Mark[];
}

export function groupThreadMessages(activeTraceId: string, nodes: Mark[]): ThreadMessage[] {
  const filteredNodes = nodes.filter(n => n.traceId === activeTraceId);
  
  // Sort nodes chronologically
  filteredNodes.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return nodes.indexOf(a) - nodes.indexOf(b);
  });

  const groups: ThreadMessage[] = [];

  // Track the current agent turn
  let currentTurnChildren: Mark[] = [];
  let currentTurnSteps = new Set<ReasoningTraceStep>();
  let turnStartNode: Mark | null = null;

  const flushAgentTurn = () => {
    if (currentTurnChildren.length === 0 || !turnStartNode) return;

    // Aggregate token usage across all steps in this turn
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheReadTokens = 0;
    let modelName: string | undefined = undefined;
    let agentName = 'Agent';
    let turnColor: string | null = null;

    currentTurnSteps.forEach(step => {
      if (step.agentName) agentName = step.agentName;
      if (step.model) modelName = step.model;
      if (step.color && !turnColor) turnColor = step.color;
      if (step.token_usage) {
        totalInputTokens += step.token_usage.input_tokens || 0;
        totalOutputTokens += step.token_usage.output_tokens || 0;
        totalCacheReadTokens += step.token_usage.cache_read_tokens || 0;
      }
    });

    if (!turnColor && turnStartNode.color) {
      turnColor = turnStartNode.color;
    }

    const turnData = {
      agentName,
      model: modelName,
      actionCount: currentTurnChildren.length,
      stepCount: currentTurnSteps.size,
      token_usage: (totalInputTokens > 0 || totalOutputTokens > 0) ? {
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        cache_read_tokens: totalCacheReadTokens
      } : undefined,
      steps: Array.from(currentTurnSteps)
    };

    groups.push({
      id: `${turnStartNode.id}_turn`,
      traceId: turnStartNode.traceId,
      type: 'turn',
      label: agentName,
      text: '',
      data: turnData,
      timestamp: turnStartNode.timestamp,
      color: turnColor,
      children: [...currentTurnChildren]
    });

    currentTurnChildren = [];
    currentTurnSteps.clear();
    turnStartNode = null;
  };

  for (const node of filteredNodes) {

    // User input or System message breaks the agent turn
    if (node.type === TraceNodeType.USER_INPUT || node.type === TraceNodeType.SYSTEM) {
      flushAgentTurn();

      groups.push({
        id: node.id,
        traceId: node.traceId,
        type: node.type,
        label: node.label || '',
        text: node.text || '',
        data: node.data,
        timestamp: node.timestamp,
        color: node.color,
        children: []
      });
      continue;
    }

    // Agent actions (thinking, tools, responses, errors)
    if (!turnStartNode) {
      turnStartNode = node;
    }
    currentTurnSteps.add(node.stepRef);
    currentTurnChildren.push(node);
  }

  // Flush any trailing agent turn
  flushAgentTurn();

  return groups;
}
