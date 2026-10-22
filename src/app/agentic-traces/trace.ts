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
 * @fileoverview The OpenTraces trace format, mirrored 1:1 from the canonical
 * schema. Mirrors opentraces-schema 0.9.0.
 *
 * Canonical source (Pydantic models; the single source of truth):
 *   https://github.com/JayFarei/opentraces/blob/main/packages/opentraces-schema/src/opentraces_schema/models.py
 * Docs: https://opentraces.ai/schema/latest
 *
 * ============================================================================
 *  DO NOT ADD, REMOVE OR RENAME FIELDS HERE THAT ARE NOT IN THE CANONICAL
 *  SCHEMA. This file must stay a faithful copy so that any OpenTraces file
 *  loads here and anything we write loads in other OpenTraces tools.
 * ============================================================================
 *
 * The only changes allowed in this file are those that track a new upstream
 * schema version (bump the version above when you do). Everything the
 * visualizer needs beyond the schema goes through the one sanctioned
 * free-form field, `TraceRecord.metadata`; the keys we use there are typed
 * and documented in `trace-extensions.ts`. Viewer-internal derived types live
 * in `layout-types.ts`. Neither of those is part of the format.
 *
 * Conventions: optional fields in the models (`X | None` or a default) are
 * optional here; `dict[str, Any]` is `Record<string, any>`.
 */

export interface TraceRecord {
  schema_version: string; // e.g. "0.9.0"
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
  /** Free-form. The only place for data outside the schema; see trace-extensions.ts. */
  metadata?: Record<string, any>;
  execution_context?: 'devtime' | 'runtime' | null;
  lifecycle?: 'provisional' | 'final';
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
  // Schema 0.8.0: optional dependency-pin / runtime-identity fields.
  resolved_dependencies?: PinRecord[] | null;
  interpreter?: Interpreter | null;
  arch?: string | null;
  platform?: string | null;
  abi_tag?: string | null;
}

export interface PinRecord {
  name: string;
  version?: string | null;
  hash?: string | null;
  marker?: string | null;
  source?: string | null;
}

export interface Interpreter {
  name?: string | null;
  version?: string | null;
}

export interface VCS {
  type: 'git' | 'none';
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
  call_type?: 'main' | 'subagent' | 'warmup' | null;
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
  start_line?: number | null;
  end_line?: number | null;
  language?: string | null;
  text?: string | null;
  source_step?: number | null;
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
