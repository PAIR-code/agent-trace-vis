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

export const TOOL_KINDS = [
  'search.text',
  'search.files',
  'search.web',
  'search.code',
  'read.file',
  'read.url',
  'browse.directory',
  'change.external',
  'file.create',
  'file.edit',
  'file.edit.multiple',
  'file.delete',
  'notebook.edit',
  'execute.command',
  'delegate.agent',
  /** Sends a message to other agents (drawn in the messages lane; see `agent_messages`). */
  'message.send',
  /** Reads, waits for or checks incoming messages (drawn in the messages lane). */
  'message.receive',
  'other',
] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];

function isToolKind(value: unknown): value is ToolKind {
  return TOOL_KINDS.some(knownKind => knownKind === value);
}

/**
 * Set on each member of a team of peer agents (e.g. agents that message each
 * other while solving one task). Unlike subagents, nobody launched anybody:
 * members are rows of equal depth, kept together on one shared axis.
 */
export interface TeamInfo {
  /** Shared by every member's trace. */
  id: string;
  /** Agent names, in display order (e.g. leader first). */
  members: string[];
  /** This trace's agent: one of `members`. */
  agent: string;
  leader?: string;
  success?: boolean;
}

/**
 * Messages between agents (team peers, or a parent and its subagents): the
 * ids of the messages this trace sent and received, by where it happened.
 * A place is a `tool_call_id` (e.g. a `send_message` or `read_messages`
 * call), or `step:<step_index>` for a step that isn't a tool call (e.g. a
 * harness notice that delivered a message). Ids are unique within a dataset;
 * the viewer draws a line from each send to each receipt of the same id.
 */
export interface AgentMessages {
  sent?: Record<string, string[]>;
  received?: Record<string, string[]>;
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

  // --- Teams of peer agents (set on every member) ---
  team?: TeamInfo;

  /** Messages to and from other agents' traces (teams and subagents alike). */
  agent_messages?: AgentMessages;

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

  /**
   * Optional normalized tool kinds, keyed by the original `tool_name`.
   * Calls keep their original names and inputs; this guides visualization.
   * Missing or invalid entries use best-effort tool-name inference.
   */
  tool_kinds?: Record<string, ToolKind>;
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
    toolKind: (toolName: string): ToolKind | undefined => {
      const kind = rec<unknown>(meta.tool_kinds)[toolName];
      return isToolKind(kind) ? kind : undefined;
    },
    subagentRefs: (toolCallId: string): string[] => {
      const refs = subagentRefs[toolCallId];
      return Array.isArray(refs) ? refs.filter((s): s is string => typeof s === 'string') : [];
    },
    team: parseTeam(meta.team),
    messages: parseMessages(meta.agent_messages),
  };
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];

/** A valid `team` entry, else undefined (it needs an id and this agent's name). */
function parseTeam(v: unknown): TeamInfo | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const t = v as Record<string, unknown>;
  if (typeof t['id'] !== 'string' || typeof t['agent'] !== 'string') return undefined;
  const members = strings(t['members']);
  return {
    id: t['id'],
    agent: t['agent'],
    members: members.includes(t['agent']) ? members : [...members, t['agent']],
    leader: typeof t['leader'] === 'string' ? t['leader'] : undefined,
    success: typeof t['success'] === 'boolean' ? t['success'] : undefined,
  };
}

/** `agent_messages` as a lookup: the message ids sent and received at a place (see `AgentMessages`). */
function parseMessages(v: unknown) {
  const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const at = (x: unknown) => (place: string): string[] =>
    x && typeof x === 'object' && !Array.isArray(x) ? strings((x as Record<string, unknown>)[place]) : [];
  return { sent: at(t['sent']), received: at(t['received']) };
}
