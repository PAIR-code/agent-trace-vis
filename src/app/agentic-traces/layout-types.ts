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
 * @fileoverview Parsed trace data types, and the inputs/outputs of the timeline layout.
 */

import type { Mark } from './marks';
import type { FileLane } from './file-lane';

export const BASE_OFFSET = 24;

export enum TraceNodeType {
  USER_INPUT = 'user_input',
  THINKING = 'thinking',
  TOOL_CALL = 'tool_call',
  TOOL_DATA = 'tool_data',
  SYSTEM = 'system',
  ERROR = 'error',
  RESPONSE = 'response',
}

/** What a step or node does. Tool nodes get theirs from `classifyTool` (tools.ts). */
export enum ReasoningStepType {
  USER_INPUT = 'USER_INPUT',
  PLANNER_RESPONSE = 'PLANNER_RESPONSE',
  SYSTEM_MESSAGE = 'SYSTEM_MESSAGE',
  VIEW_FILE = 'VIEW_FILE',
  GREP_SEARCH = 'GREP_SEARCH',
  FIND_BY_NAME = 'FIND_BY_NAME',
  LIST_DIRECTORY = 'LIST_DIRECTORY',
  RUN_COMMAND = 'RUN_COMMAND',
  WRITE_TO_FILE = 'WRITE_TO_FILE',
  REPLACE_FILE_CONTENT = 'REPLACE_FILE_CONTENT',
  MULTI_REPLACE_FILE_CONTENT = 'MULTI_REPLACE_FILE_CONTENT',
  DELETE_FILE = 'DELETE_FILE',
  NOTEBOOK_EDIT = 'NOTEBOOK_EDIT',
  READ_URL_CONTENT = 'READ_URL_CONTENT',
  SEARCH_WEB = 'SEARCH_WEB',
  CODE_SEARCH = 'CODE_SEARCH',
  INVOKE_SUBAGENT = 'INVOKE_SUBAGENT',
  GENERIC = 'GENERIC',
}

export interface ReasoningTrace {
  id: string;
  title: string;
  steps: ReasoningTraceStep[];
  metadata?: Record<string, any>;
  agentColor?: string;
  agents?: { name: string; model?: string; color: string }[];
  date?: string;
  timestamp?: number;
  /** The record's own trace id (what other traces refer to it by). */
  sourceId?: string;
  /** For a subagent trace: the launching trace's id and tool call. */
  parentSourceId?: string;
  parentToolCallId?: string;
  /**
   * Where the harness keeps the agent's own scratch files and plans, as local
   * paths (from `metadata.artifact_dirs`). Writes there are drawn in their own
   * lane instead of the files lane (see `isArtifact` in file-events.ts).
   */
  artifactDirs?: string[];
}

import { TokenUsage } from './trace';

/** One trace in the loaded dataset (an item in the trace picker). */
export interface TraceEntry {
  id: string;
  title: string;
  /** Source URL for local traces; '' for Hugging Face ones. */
  file: string;
  /** Null if the trace failed to load. */
  data: ReasoningTrace | null;
  agents: { name: string; model?: string; color: string }[];
  /** Start date shown in the picker, e.g. "Sep 28". */
  date?: string;
  /** Entry id of the trace that launched this one as a subagent, if it is in the dataset (see subagents.ts). */
  parentId?: string;
  /** Tool call in the parent that launched this subagent. */
  parentToolCallId?: string;
}

export interface ReasoningTraceStep {
  id: string;
  timestamp?: string;
  completedAt?: string;
  model?: string;
  agentName?: string;
  userIntent?: string;
  stepType?: ReasoningStepType;
  nodes: ReasoningTraceNode[];
  token_usage?: TokenUsage;
  /** Reasoning tokens (a breakdown of output tokens); from `metadata.reasoning_tokens`. */
  reasoningTokens?: number;
  /** On a user step: totals for the turn it opens; from `metadata.turn_token_usage`. */
  turnTokenUsage?: TokenUsage;
  color?: string;
}

export interface ReasoningTraceNode {
  id: string;
  type: TraceNodeType;
  text: string;
  stepType?: ReasoningStepType;
  timestamp?: string;
  completedAt?: string;
  data: any;
}


export interface BackboneLine {
  id: string;
  traceId: string;
  path: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity: number;
}

/** Everything drawn in one trace row. */
export interface TraceLayout {
  id: string;
  title: string;
  agentColor: string;
  marks: Mark[];
  backbone: BackboneLine[];
  files: FileLane;
  /** 0 for a top-level trace; 1 for its subagents, 2 for theirs, etc. */
  depth: number;
  /** For a subagent row: the row it hangs under, and the x where it branches off. */
  parent?: { id: string; x: number };
}

export interface LayoutOutput {
  traces: TraceLayout[];
  contentWidth: number;
  contentHeight: number;
  timeTicks: Array<{ label: string, x: number }>;
}

/**
 * What the x axis measures: elapsed time, cumulative tokens, or sequence (one
 * unit per node, for traces with no timestamps; shown as "Steps").
 */
export type AxisMode = 'time' | 'tokens' | 'sequence';

export interface LayoutParams {
  traces: TraceEntry[];
  selectedTraceIds: Set<string>;
  /** The effective axis: callers resolve an unavailable 'time' to 'sequence' first. */
  yAxisMode: AxisMode;
  hideGaps: boolean;
  selectedTokenTypes?: Set<string>;
  containerWidth?: number;
  stretch?: boolean;
}
