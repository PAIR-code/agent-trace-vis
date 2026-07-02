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
 * @fileoverview Defines the data structures and shapes of elements drawn in the visualization.
 * 
 * This includes:
 * - Interactive Nodes (User inputs, model responses, system events, tools)
 * - Thinking Areas (The wide color bands representing model reasoning effort)
 * - Backbone Lines (The vertical/horizontal tracks showing the flow of execution)
 * - Connection Lines (Lines connecting tools or user interactions back to the backbone)
 */

export enum TraceNodeColumn {
  USER = 'user',
  AGENT = 'agent',
  TOOLS = 'tools'
}

export const BASE_OFFSET = 24;

export enum TraceNodeType {
  USER_INPUT = 'user_input',
  THINKING = 'thinking',
  TOOL_CALL = 'tool_call',
  TOOL_DATA = 'tool_data',
  SYSTEM = 'system',
  ERROR = 'error',
  RESPONSE = 'response',
  THINKING_AREA = 'thinking_area'
}

export enum ReasoningStepType {
  USER_INPUT = 'USER_INPUT',
  PLANNER_RESPONSE = 'PLANNER_RESPONSE',
  VIEW_FILE = 'VIEW_FILE',
  GREP_SEARCH = 'GREP_SEARCH',
  RUN_COMMAND = 'RUN_COMMAND',
  LIST_DIRECTORY = 'LIST_DIRECTORY',
  CODE_ACTION = 'CODE_ACTION',
  WRITE_TO_FILE = 'WRITE_TO_FILE',
  REPLACE_FILE_CONTENT = 'REPLACE_FILE_CONTENT',
  MULTI_REPLACE_FILE_CONTENT = 'MULTI_REPLACE_FILE_CONTENT',
  NOTEBOOK_EDIT = 'NOTEBOOK_EDIT',
  READ_URL_CONTENT = 'READ_URL_CONTENT',
  CODE_SEARCH = 'CODE_SEARCH',
  INTERNAL_SEARCH = 'INTERNAL_SEARCH',
  FIND = 'FIND',
  FIND_BY_NAME = 'FIND_BY_NAME',
  TASK_BOUNDARY = 'TASK_BOUNDARY',
  CHECKPOINT = 'CHECKPOINT',
  EPHEMERAL_MESSAGE = 'EPHEMERAL_MESSAGE',
  SYSTEM_MESSAGE = 'SYSTEM_MESSAGE',
  ERROR_MESSAGE = 'ERROR_MESSAGE',
  NOTIFY_USER = 'NOTIFY_USER',
  CONVERSATION_HISTORY = 'CONVERSATION_HISTORY',
  KNOWLEDGE_ARTIFACTS = 'KNOWLEDGE_ARTIFACTS',
  GENERIC = 'GENERIC',
  COMMAND_STATUS = 'COMMAND_STATUS',
  SEND_COMMAND_INPUT = 'SEND_COMMAND_INPUT',
  SEARCH_WEB = 'SEARCH_WEB',
  VIEW_CONTENT_CHUNK = 'VIEW_CONTENT_CHUNK',
  VIEW_FILE_OUTLINE = 'VIEW_FILE_OUTLINE'
}

export enum ModelType {
  OPUS = 'Opus',
  SONNET = 'Sonnet',
  HAIKU = 'Haiku'
}

export enum ModelFamily {
  GEMINI = 'Gemini',
  CLAUDE = 'Claude',
  GPT = 'GPT',
  LLAMA = 'Llama',
  MISTRAL = 'Mistral',
  QWEN = 'Qwen',
  UNKNOWN = 'Agent'
}

export interface ReasoningTrace {
  id: string;
  title: string;
  steps: ReasoningTraceStep[];
  metadata?: Record<string, any>;
  agentColor?: string;
  darkerAgentColor?: string;
  models?: { name: string; color: string }[];
  date?: string;
  timestamp?: number;
}

import { TokenUsage } from './trace';

export interface ReasoningTraceStep {
  id: string;
  timestamp?: string;
  completedAt?: string;
  model?: ModelType;
  modelFamily?: ModelFamily;
  userIntent?: string;
  stepType?: ReasoningStepType;
  nodes: ReasoningTraceNode[];
  token_usage?: TokenUsage;
}

export interface ReasoningTraceNode {
  id: string;
  type: TraceNodeType;
  column: TraceNodeColumn;
  text: string;
  stepType?: ReasoningStepType;
  timestamp?: string;
  completedAt?: string;
  data: any;
}


export interface BaseVisNode {
  id: string;
  traceId: string;
  type: TraceNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ConnectionLine {
  id: string;
  path: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  strokeDasharray?: string;
  fill?: string;
}

export interface InteractiveNodeBase extends BaseVisNode {
  label: string;
  text: string;
  data: any; // original trace step JSON
  timestamp?: string;
  color: string | null;
  hidden?: boolean;
  isWaiting?: boolean;
  isFailed?: boolean;
  connectionLine?: ConnectionLine;
  returnConnectionLine?: ConnectionLine;
  stepType?: ReasoningStepType;
}

export interface UserInputNode extends InteractiveNodeBase {
  type: TraceNodeType.USER_INPUT;
  column: 'user';
}

export interface ResponseNode extends InteractiveNodeBase {
  type: TraceNodeType.RESPONSE;
  column: 'user';
  connectionLine: ConnectionLine;
}

export interface ThinkingStepNode extends InteractiveNodeBase {
  type: TraceNodeType.THINKING;
  column: 'agent';
  units: number; // thinking area units (1 to 4)
  isWaiting: boolean;
  segmentHeight: number;
  segmentY: number;
}

export interface ToolCallNode extends InteractiveNodeBase {
  type: TraceNodeType.TOOL_CALL;
  column: 'agent';
  connectionLine: ConnectionLine;
}

export interface ToolDataNode extends InteractiveNodeBase {
  type: TraceNodeType.TOOL_DATA;
  column: 'tools';
  connectionLine: ConnectionLine;
}

export interface SystemNode extends InteractiveNodeBase {
  type: TraceNodeType.SYSTEM;
  column: 'agent';
  connectionLine: ConnectionLine;
}

export interface ErrorNode extends InteractiveNodeBase {
  type: TraceNodeType.ERROR;
  column: 'agent';
  followedByRateLimit?: boolean;
  connectionLine?: ConnectionLine;
}

export type VisNode = 
  | UserInputNode 
  | ResponseNode 
  | ThinkingStepNode 
  | ToolCallNode 
  | ToolDataNode 
  | SystemNode 
  | ErrorNode
  | ThinkingAreaNode;

export interface ThinkingAreaNode extends InteractiveNodeBase {
  type: TraceNodeType.THINKING_AREA;
  path: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
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

export interface LayoutOutput {
  nodes: VisNode[];
  backboneLines: BackboneLine[];
  contentWidth: number;
  contentHeight: number;
  timeTicks: Array<{ label: string, y: number, x?: number }>;
  timeUnitLabel: string;
}

export interface LayoutParams {
  traces: any[];
  selectedTraceIds: Set<string>;
  yAxisMode: 'default' | 'time' | 'tokens';
  layoutMode: 'column' | 'row';
  hideGaps: boolean;
  selectedTokenTypes?: Set<string>;
}
