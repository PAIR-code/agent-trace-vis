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
 * @fileoverview What this visualizer reads from `TraceRecord.metadata`.
 *
 * The OpenTraces schema (`trace.ts`) is mirrored exactly and must not be
 * extended. Anything a converter knows that the schema has no field for goes
 * into the record's free-form `metadata` object instead, under the keys
 * below. A file that omits them is still a complete trace; the viewer just
 * falls back to what the schema provides (step order, a single timestamp per
 * step, no subagent nesting).
 *
 * Per-step and per-tool-call data is keyed by `step_index` (as a string, since
 * it's a JSON object key) and `tool_call_id` respectively, so the schema
 * objects themselves stay untouched.
 */

import type { TokenUsage, TraceRecord } from './trace';

export interface StepTiming {
  /**
   * When the model finished generating this step. With the step's `timestamp`
   * (when it started) this is the thinking/writing span.
   */
  generated_at?: string;
  /** When the step's last tool call returned, i.e. when the step ended. */
  completed_at?: string;
}

export interface ToolTiming {
  /** When the tool started running; with the schema's `duration_ms`, its span. */
  started_at?: string;
}

/** The `metadata` keys the visualizer understands. All optional. */
export interface TraceVisMetadata {
  /**
   * Where the harness keeps the agent's own scratch files and plans, as
   * `file://` URIs or local paths. Writes there are drawn in their own lane.
   */
  artifact_dirs?: string[];

  // --- Subagents: how a child trace was launched (set on the child) ---
  parent_trace_id?: string;
  parent_tool_call_id?: string;
  subagent_role?: string;
  /** On the parent: trace ids launched by each tool call, by `tool_call_id`. */
  subagent_refs?: Record<string, string[]>;

  // --- Timing beyond the schema's single `timestamp` per step ---
  step_timing?: Record<string, StepTiming>;
  tool_timing?: Record<string, ToolTiming>;

  /**
   * Reasoning tokens per step, by `step_index`. A breakdown of the step's
   * `output_tokens`, not an addition to it (so never summed with it). Lets the
   * thinking lane show how much a model thought when the provider withholds
   * the reasoning text.
   */
  reasoning_tokens?: Record<string, number>;

  /**
   * Token totals per conversational turn, by the `step_index` of the user
   * step that opened it. For harnesses that report usage per turn but not per
   * LLM call (steps then carry no `token_usage` of their own).
   */
  turn_token_usage?: Record<string, TokenUsage>;
}

/** Typed, null-safe access to the extension keys of a record's metadata. */
export function traceExtensions(record: Pick<TraceRecord, 'metadata'>) {
  const meta: TraceVisMetadata = (record.metadata ?? {}) as TraceVisMetadata;
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const rec = <T>(v: unknown): Record<string, T> =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};
  const stepTiming = rec<StepTiming>(meta.step_timing);
  const toolTiming = rec<ToolTiming>(meta.tool_timing);
  const reasoning = rec<number>(meta.reasoning_tokens);
  const subagentRefs = rec<string[]>(meta.subagent_refs);
  const turnUsage = rec<TokenUsage>(meta.turn_token_usage);
  return {
    artifactDirs: Array.isArray(meta.artifact_dirs) ? meta.artifact_dirs.filter((s): s is string => typeof s === 'string') : undefined,
    parentTraceId: str(meta.parent_trace_id),
    parentToolCallId: str(meta.parent_tool_call_id),
    subagentRole: str(meta.subagent_role),
    stepTiming: (stepIndex: number): StepTiming => stepTiming[String(stepIndex)] ?? {},
    toolTiming: (toolCallId: string): ToolTiming => toolTiming[toolCallId] ?? {},
    reasoningTokens: (stepIndex: number): number | undefined => {
      const n = reasoning[String(stepIndex)];
      return typeof n === 'number' && n > 0 ? n : undefined;
    },
    turnTokenUsage: (stepIndex: number): TokenUsage | undefined => turnUsage[String(stepIndex)],
    subagentRefs: (toolCallId: string): string[] => {
      const refs = subagentRefs[toolCallId];
      return Array.isArray(refs) ? refs.filter((s): s is string => typeof s === 'string') : [];
    },
  };
}
