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
 * @fileoverview Marks: the one visual element drawn for each trace node.
 *
 * Every trace node becomes exactly one `Mark`, and the mark's geometry is what
 * gets drawn. `MARK_SPECS` declares, per node type, which channel the mark sits
 * in, how it hangs off that channel's center line, and how big it is.
 * `buildMarks` walks one trace and places every mark in a single pass.
 */

import { getAgentColor } from './colors';
import { ChannelId, channelCenter } from './channels';
import { AxisMode, BASE_OFFSET, ReasoningStepType, ReasoningTraceNode, ReasoningTraceStep, TraceNodeType } from './layout-types';
import { getStepTokens, stepAxisLength, truncate, wordCount } from './layout-utils';
import { fileAccess, toolIcon } from './tools';
import { XAxis } from './x-scale';

/** Styling hints for a mark; shape and base colors come from CSS keyed on `type`. */
export interface MarkLook {
  /** Glyph drawn inside the mark (replaces the type's shape). */
  icon?: 'command' | 'search';
  /** Only set where the border follows the step's agent color (system marks). */
  borderColor?: string;
  /** A tool call whose observation reported an error. */
  failed?: boolean;
}

/** One drawn element, plus the trace data that the side panel and search need. */
export interface Mark {
  id: string;
  traceId: string;
  type: TraceNodeType;
  channel: ChannelId;
  /** Geometry in px, relative to the trace track. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fill color (the step's agent color), or null to use the type's CSS color. */
  color: string | null;
  look: MarkLook;
  /** Not drawn in the main track (file events live in the files lane). */
  hidden?: boolean;
  // Trace data, passed through for the conversation panel, search and files lane.
  label: string;
  text: string;
  data: any;
  stepRef: ReasoningTraceStep;
  timestamp?: string;
  stepType?: ReasoningStepType;
}

/** Vertical placement relative to the channel's center line. */
type Anchor =
  | 'above'   // sits just above the line
  | 'below'   // sits just below the line
  | 'center'  // centered on the line
  | 'hang';   // top edge on the line, grows downward

interface MarkSpec {
  channel: ChannelId;
  anchor: Anchor;
  /** px; 'step' = spans the whole step. */
  width: number | 'step';
  /** px; 'speech' = scaled by step tokens; 'effort' = scaled by thinking tokens. */
  height: number | 'speech' | 'effort';
  /** Filled with the step's agent color. */
  agentFill?: boolean;
}

const ICON = 12;
const SPEECH_WIDTH = 7;
/** Sequence mode: space left between a bar and the next slot. */
const SLOT_GUTTER = 2;

/** Placement rules for each node type. */
const MARK_SPECS: Record<string, MarkSpec> = {
  // The conversation (user and agent) sits above the line; thinking hangs below it.
  [TraceNodeType.USER_INPUT]: { channel: 'user',  anchor: 'above',  width: SPEECH_WIDTH, height: 'speech' },
  [TraceNodeType.RESPONSE]:   { channel: 'user',  anchor: 'above',  width: SPEECH_WIDTH, height: 'speech', agentFill: true },
  [TraceNodeType.THINKING]:   { channel: 'agent', anchor: 'hang',   width: 'step',       height: 'effort', agentFill: true },
  // A tool call with no logged result is still a tool call: same lane as one with a result.
  [TraceNodeType.TOOL_CALL]:  { channel: 'tools', anchor: 'center', width: ICON,         height: ICON },
  [TraceNodeType.SYSTEM]:     { channel: 'agent', anchor: 'center', width: ICON,         height: ICON },
  [TraceNodeType.ERROR]:      { channel: 'agent', anchor: 'center', width: ICON,         height: ICON },
  [TraceNodeType.TOOL_DATA]:  { channel: 'tools', anchor: 'center', width: ICON,         height: ICON },
};

/** Directory listings sit below the tools line, clear of other tool results. */
const LIST_DIR_SPEC: MarkSpec = { ...MARK_SPECS[TraceNodeType.TOOL_DATA], anchor: 'below' };

function anchorY(anchor: Anchor, center: number, height: number): number {
  switch (anchor) {
    case 'above': return center - height - 1;
    case 'below': return center + 1;
    case 'center': return center - height / 2;
    case 'hang': return center;
  }
}

/** Speech (user/response) height: 10–22px by step tokens; constant off the time axis. */
const SPEECH_FIXED_HEIGHT = 18;
function speechHeight(tokens: number, maxTokens: number, mode: AxisMode): number {
  if (mode !== 'time') return SPEECH_FIXED_HEIGHT;
  return Math.round(Math.min(22, 10 + 12 * tokens / maxTokens));
}

/**
 * Thinking-block depth: 8–40px by thinking tokens. Constant off the time axis:
 * 30px in tokens mode (the block still spans its step), speech-bar height in
 * sequence mode (it is one slot, the mirror of the response bar above the line).
 */
function effortHeight(tokens: number, maxTokens: number, mode: AxisMode): number {
  if (mode === 'sequence') return SPEECH_FIXED_HEIGHT;
  if (mode === 'tokens') return 30;
  return 8 + 32 * tokens / maxTokens;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

/** Rate-limit retries are kept in the conversation but not drawn. */
function isRateLimitNode(node: ReasoningTraceNode): boolean {
  return !!node.text?.includes('servers are experiencing high traffic') ||
         !!node.text?.includes('retryable error from model provider');
}

function markLook(node: ReasoningTraceNode, stepColor: string): MarkLook {
  switch (node.type) {
    case TraceNodeType.USER_INPUT:
    case TraceNodeType.RESPONSE:
    case TraceNodeType.THINKING:
      return {};
    case TraceNodeType.SYSTEM:
      return { borderColor: stepColor };
  }
  return {
    icon: toolIcon(node.stepType),
    failed: (node.type === TraceNodeType.TOOL_DATA && !!node.data?.observation?.error) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** What `buildMarks` needs to know about a trace. */
export interface MarkTraceInput {
  id: string;
  steps: ReasoningTraceStep[];
  /** Fallback agent identity (for colors) when a step doesn't name its own. */
  agentName: string;
  model?: string;
  /** Largest step token count; speech marks are scaled against it. */
  maxStepTokens: number;
}

/** Tokens used to size a node's mark: its step's token usage, else its word count. */
function sizeTokens(step: ReasoningTraceStep, node: ReasoningTraceNode, tokenTypes?: Set<string>): number {
  return step.token_usage ? getStepTokens(step.token_usage, tokenTypes) : wordCount(node.text);
}

/** Axis position (ms, tokens or nodes) where a step starts and ends; NaN if unknown. */
function stepRange(steps: ReasoningTraceStep[], i: number, mode: AxisMode,
                   before: number, tokenTypes?: Set<string>): [number, number] {
  const step = steps[i];
  if (mode !== 'time') return [before, before + stepAxisLength(step, mode, tokenTypes)];

  const ms = (ts?: string) => ts ? new Date(ts).getTime() : NaN;
  let end = ms(step.completedAt);
  // No completion time: an agent step lasts until the next agent step starts.
  // User and system messages end the span: they're outside events the agent
  // was waiting on (a system notification can arrive days later), not work.
  const next = steps[i + 1];
  const isExternal = (s: ReasoningTraceStep) =>
    s.stepType === ReasoningStepType.USER_INPUT || s.stepType === ReasoningStepType.SYSTEM_MESSAGE;
  if (isNaN(end) && next && !isExternal(next) && !isExternal(step)) {
    end = ms(next.timestamp);
  }
  return [ms(step.timestamp), end];
}

/**
 * Places a mark for every node in the trace on the given axis.
 * Returns the marks and the right edge of the drawn content.
 */
export function buildMarks(trace: MarkTraceInput, axis: XAxis, mode: AxisMode,
                           tokenTypes?: Set<string>): { marks: Mark[]; maxX: number } {
  const marks: Mark[] = [];
  let maxEffortTokens = 1;
  for (const step of trace.steps) {
    for (const node of step.nodes) {
      if (node.type === TraceNodeType.THINKING && !isRateLimitNode(node)) {
        maxEffortTokens = Math.max(maxEffortTokens, sizeTokens(step, node, tokenTypes));
      }
    }
  }

  let maxX = 20;
  // Cumulative axis position (tokens or nodes) of the steps so far; unused in time mode.
  let before = 0;
  // Fallback x for nodes without a usable timestamp: march along after the previous mark.
  let cursorX = BASE_OFFSET;

  trace.steps.forEach((step, i) => {
    const [start, end] = stepRange(trace.steps, i, mode, before, tokenTypes);
    before = mode !== 'time' ? end : 0;
    const stepColor = step.color || getAgentColor(step.agentName || trace.agentName, step.model || trace.model);
    const stepX0 = axis.toX(start);
    const stepX1 = axis.toX(end);

    // Within a step we know the order of events, not their times. Reasoning
    // spans the step; the actions (tool calls, response) follow in order, one
    // icon apart, ending at the step's right edge: thought, then acted. With
    // no reasoning, they start at the step's start.
    const drawn = step.nodes.filter(n => !isRateLimitNode(n));
    const actions = drawn.filter(n => n.type !== TraceNodeType.THINKING);
    const actionsX0 = actions.length === drawn.length ? stepX0
      : isNaN(stepX1) ? stepX0 + ICON
      : Math.max(stepX0, stepX1 - actions.length * ICON);
    // Never run past the next step's start: when zoomed out, squeeze the
    // actions together (they overlap) so marks stay in time order.
    const next = trace.steps[i + 1];
    const limitX = mode === 'time' && next?.timestamp ? axis.toX(new Date(next.timestamp).getTime()) : stepX1;
    const actionGap = actions.length > 1 && !isNaN(limitX)
      ? Math.max(0, Math.min(ICON, (limitX - actionsX0 - ICON) / (actions.length - 1)))
      : ICON;

    step.nodes.forEach((node, k) => {
      const base = {
        id: node.id, traceId: trace.id, label: truncate(node.text || '', 80), text: node.text,
        data: node.data, stepRef: step, timestamp: node.timestamp, stepType: node.stepType,
      };
      if (isRateLimitNode(node)) {
        marks.push({ ...base, type: TraceNodeType.ERROR, channel: 'agent', x: 0, y: 0, width: 0, height: 0,
                     color: null, look: {}, hidden: true });
        return;
      }

      const isTool = node.type === TraceNodeType.TOOL_DATA || node.type === TraceNodeType.TOOL_CALL;
      const spec = isTool && node.stepType === ReasoningStepType.LIST_DIRECTORY ? LIST_DIR_SPEC
        : MARK_SPECS[node.type] ?? MARK_SPECS[TraceNodeType.TOOL_DATA];

      // Sequence mode: the step is one slot per node, so each node sits in its
      // own slot and nothing spans the step. Bars fill the slot (less a gutter);
      // icons keep their shape and are centered in it. Otherwise reasoning
      // spans the step and the actions trail it (see above).
      const slot = mode === 'sequence' ? drawn.indexOf(node) : -1;
      let x: number, width: number;
      if (slot >= 0) {
        const slotX = axis.toX(start + slot);
        const slotW = axis.toX(start + slot + 1) - slotX;
        // File-access nodes aren't drawn here, but the files lane takes their
        // geometry, so they get the bar shape as well.
        const isBar = spec.height === 'speech' || spec.height === 'effort' || fileAccess(node.stepType) !== null;
        width = isBar ? Math.max(1, slotW - SLOT_GUTTER) : spec.width as number;
        x = slotX + (slotW - width) / 2;
      } else {
        x = node.type === TraceNodeType.THINKING ? stepX0 : actionsX0 + actions.indexOf(node) * actionGap;
        if (isNaN(x)) x = cursorX;
        width = spec.width === 'step' ? Math.max(1, (isNaN(stepX1) ? x + ICON : stepX1) - x) : spec.width;
      }

      const tokens = sizeTokens(step, node, tokenTypes);
      const height = spec.height === 'speech' ? speechHeight(tokens, trace.maxStepTokens, mode)
        : spec.height === 'effort' ? effortHeight(tokens, maxEffortTokens, mode)
        : spec.height;

      marks.push({
        ...base,
        type: node.type,
        channel: spec.channel,
        x, y: anchorY(spec.anchor, channelCenter(spec.channel), height), width, height,
        color: spec.agentFill ? stepColor : null,
        look: markLook(node, stepColor),
        hidden: fileAccess(node.stepType) !== null || undefined,
      });

      cursorX = x + width + (k === 0 ? ICON : 0);
      maxX = Math.max(maxX, x + width);
    });
  });

  return { marks, maxX };
}
