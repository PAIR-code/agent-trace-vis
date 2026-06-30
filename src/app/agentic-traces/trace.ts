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
 * @fileoverview Type definitions for the OpenTraces protocol format (v0.7.0).
 * Reference: https://opentraces.ai/schema/latest
 */

export interface TraceRecord {
  schema_version: string; // e.g. "0.7.0"
  trace_id: string; // UUID for this trace
  session_id: string; // Agent's native session ID
  content_hash?: string;
  timestamp_start?: string;
  timestamp_end?: string;
  task?: Task;
  agent: Agent;
  environment?: Environment;
  system_prompts?: Record<string, string>;
  tool_definitions?: any[];
  steps: Step[];
  outcome?: Outcome;
  dependencies?: string[];
  metrics?: Metrics;
  security?: SecurityMetadata;
  attribution?: Attribution;
  metadata?: Record<string, any>;
  execution_context?: string | null;
  lifecycle?: string;
  git_links?: GitLink[];
  generation_index?: number;
  context_tree_summary?: any;
  patches?: Patch[];
}

export interface Task {
  description?: string;
  source?: string;
  repository?: string;
  base_commit?: string;
  repository_url?: string;
}

export interface Agent {
  name: string;
  version?: string;
  model?: string;
}

export interface Environment {
  os?: string;
  shell?: string;
  vcs?: VCS;
  language_ecosystem?: string[];
}

export interface VCS {
  type: string;
  base_commit?: string;
  branch?: string;
  diff?: string;
}

export interface Step {
  step_index: number;
  role: 'system' | 'user' | 'agent';
  content?: string;
  reasoning_content?: string;
  model?: string;
  system_prompt_hash?: string;
  agent_role?: string;
  parent_step?: number;
  call_type?: string;
  subagent_trajectory_ref?: string;
  tools_available?: string[];
  tool_calls?: ToolCall[];
  observations?: Observation[];
  snippets?: Snippet[];
  token_usage?: TokenUsage;
  timestamp?: string;
  context_node_id?: string | null;
}

export interface ToolCall {
  tool_call_id: string;
  tool_name: string;
  input?: Record<string, any>;
  duration_ms?: number;
}

export interface Observation {
  source_call_id: string;
  content?: string;
  output_summary?: string;
  error?: string;
}

export interface Snippet {
  file_path: string;
  content: string;
}

export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  prefix_reuse_tokens?: number;
}

export interface Outcome {
  success?: boolean;
  signal_source?: string;
  signal_confidence?: string;
  description?: string;
  committed?: boolean;
  commit_sha?: string;
  terminal_state?: string | null;
  reward?: number | null;
  reward_source?: string | null;
}

export interface Metrics {
  total_steps?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_duration_s?: number;
  cache_hit_rate?: number;
  estimated_cost_usd?: number;
  total_cache_read_tokens?: number;
  total_cache_creation_tokens?: number;
}

export interface SecurityMetadata {
  scanned?: boolean;
  flags_reviewed?: number;
  redactions_applied?: number;
  classifier_version?: string | null;
}

export interface Attribution {
  experimental?: boolean;
  files?: any[];
  revision?: any;
  unaccounted_files?: string[];
}

export interface GitLink {
  vcs_type: string;
  revision: string;
  repo_url?: string;
  branch?: string;
  tier: string;
  commit_reachable?: boolean;
  content_alive?: boolean;
}

export interface Patch {
  patch_id: string;
  file_path: string;
  step_index?: number | null;
  tool_call_id?: string | null;
  capture_method?: string[];
  snapshot_before_id?: string | null;
  snapshot_after_id?: string | null;
  anchor?: any | null;
  superseded_by?: string[];
  limitations?: string[];
}
